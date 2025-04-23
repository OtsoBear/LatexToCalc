//background.js

// Default settings
let settingsPromise = new Promise((resolve) => {
    chrome.storage.sync.get("settings", (data) => {
        if (data.settings) {
            console.debug('%c LatexToCalc [BG] › %cSettings loaded from storage', 'color:#2196F3;font-weight:bold', '');
            resolve(data.settings);
        } else {
            const defaultSettings = {
                TI_on: true,
                SC_on: false,
                constants_on: true,
                coulomb_on: false,
                e_on: false,
                i_on: false,
                g_on: false
            };
            chrome.storage.sync.set({ settings: defaultSettings }, () => {
                console.debug('%c LatexToCalc [BG] › %cDefault settings saved to storage', 'color:#2196F3;font-weight:bold', '');
                resolve(defaultSettings);
            });
        }
    });
});

// Create a global variable to hold the controller for the main operation
let mainAbortController;
let processStartTime;
// Detailed timing measurements for the entire process
let timingBreakdown = {};
// Global cache for the most recent input and translated output
let lastInputLatex = '';
let lastOutputCalcSyntax = '';

// Connection warmup flag to track if we've made the first request
let connectionWarmedUp = false;

// Warm up the connection and translation engine on extension load
async function warmupTranslationEngine() {
    const warmupStartTime = performance.now();
    console.debug('%c LatexToCalc [BG] › %cStarting translation engine warmup...', 'color:#2196F3;font-weight:bold', '');
    
    try {
        // Load settings before making the warmup request
        const settings = await settingsPromise;
        
        // Make an actual translation request with a simple expression to warm up the full pipeline
        const response = await fetch("https://otso.veistera.com/translate", { 
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                ...(chrome.runtime?.id ? {'Origin': chrome.runtime.id} : {})
            },
            mode: 'cors',
            credentials: 'omit',
            // Send a simple expression to warm up the translation engine
            body: JSON.stringify({ 
                expression: "1+1", 
                ...settings 
            })
        });
        
        if (response.ok) {
            await response.json(); // Process the response to complete the warmup
            connectionWarmedUp = true;
            const warmupTime = Math.round(performance.now() - warmupStartTime);
            console.debug('%c LatexToCalc [BG] › %cTranslation engine warmed up in %c' + warmupTime + ' ms', 'color:#2196F3;font-weight:bold', '', 'font-weight:bold');
        } else {
            throw new Error("Server returned an error");
        }
    } catch (error) {
        const failTime = Math.round(performance.now() - warmupStartTime);
        console.debug('%c LatexToCalc [BG] › %cTranslation engine warmup failed after %c' + failTime + ' ms: %c' + error, 'color:#2196F3;font-weight:bold', '', 'font-weight:bold', 'color:#F44336');
    }
}

// Call the warmup function when the extension loads
// We'll delay it slightly to ensure settings are loaded
setTimeout(warmupTranslationEngine, 500);

// Function to send a message to the active tab to show the popup
function showErrorPopupInTab(tabId, message) {
    chrome.tabs.sendMessage(tabId, { type: 'SHOW_ERROR_POPUP', message: message });
}

// Function to check if the user has an active internet connection
async function checkInternetConnection() {
    try {
        // Using a different URL known not to require CORS
        const response = await fetch('https://ipv4.icanhazip.com/', { method: 'GET' });
        return response.ok;
    } catch (error) {
        console.error('%c LatexToCalc [BG] › %cNetwork error: %c' + error, 'color:#2196F3;font-weight:bold', '', 'color:#F44336');
        return false;
    }
}

// Listen for settings update message from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "SETTINGS_UPDATED") {
        settings = request.settings;  // Update the settings with the new values
        
        // Optionally store them in chrome storage for persistence
        chrome.storage.sync.set({ settings: settings }, () => {
            console.debug('%c LatexToCalc [BG] › %cSettings saved in storage', 'color:#2196F3;font-weight:bold', '');
        });
    }
});

// Listen for the command to translate clipboard content
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'translate-clipboard') {
        console.log('%c LatexToCalc [BG] › %cTranslation command received', 'color:#2196F3;font-weight:bold', '');
        processStartTime = performance.now();
        timingBreakdown = {
            keypress: processStartTime,
            latexReceived: 0,
            translationStart: 0,
            translationEnd: 0,
            clipboardWritten: 0
        };

        if (mainAbortController) {
            mainAbortController.abort();
            console.debug('%c LatexToCalc [BG] › %cAborted previous translation request', 'color:#2196F3;font-weight:bold', '');
        }
        mainAbortController = new AbortController();

        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = activeTabs[0];
        if (activeTab) {
            console.debug('%c LatexToCalc [BG] › %cExecuting content script in tab %c' + activeTab.id, 'color:#2196F3;font-weight:bold', '', 'font-weight:bold');
            chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                function: async () => {
                    const latexContent = await extractLatexContent(); // Renamed function from getTextFromIframe
                    if (latexContent && latexContent.trim() !== "") {
                        chrome.runtime.sendMessage({ type: "LATEX_EXTRACTED", latexContent: latexContent });
                    } else {
                        try {
                            const textFromClipboard = await navigator.clipboard.readText();
                            chrome.runtime.sendMessage({ type: "LATEX_EXTRACTED", latexContent: textFromClipboard });
                        } catch (error) {
                            console.error('%c LatexToCalc [BG] › %cError reading from clipboard: %c' + error, 'color:#2196F3;font-weight:bold', '', 'color:#F44336');
                            chrome.runtime.sendMessage({
                                type: 'SHOW_ERROR_POPUP',
                                message: 'Failed to read from clipboard. Please try again.'
                            });
                        }
                    }
                }
            });
        } else {
            console.warn('%c LatexToCalc [BG] › %cNo active tab found', 'color:#2196F3;font-weight:bold', 'color:#FF9800');
        }
    }
});

// Listen for messages from the content script (latex content extracted)
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.type === "LATEX_EXTRACTED") {
        const latexContent = request.latexContent;
        timingBreakdown.latexReceived = performance.now();
        
        // Print the original LaTeX before translation
        console.log('%c LatexToCalc [BG] › %cSource LaTeX: %c' + latexContent, 'color:#2196F3;font-weight:bold', '', 'font-style:italic;color:#673AB7');
        
        // Log whether this is the first request after extension load
        if (!connectionWarmedUp) {
            console.debug('%c LatexToCalc [BG] › %cFirst translation request - server may need to initialize', 'color:#2196F3;font-weight:bold', 'color:#FF9800');
        }

        // Check if the latex content is the same as the last input or last output (cache check)
        if (latexContent === lastInputLatex || latexContent === lastOutputCalcSyntax) {
            console.log('%c LatexToCalc [BG] › %cUsing cached translation', 'color:#2196F3;font-weight:bold', '');
            // Use cached translation
            timingBreakdown.translationStart = performance.now();
            timingBreakdown.translationEnd = timingBreakdown.translationStart; // No actual translation
            copyTranslationToClipboard(lastOutputCalcSyntax, true); // Pass true to indicate timing should be measured

            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = activeTabs[0];
            if (activeTab) {
                // Send a message to the active tab to show the "Translated" popup
                chrome.tabs.sendMessage(activeTab.id, { type: 'TRANSLATION_COMPLETED', totalTime: 0 });
            }
            return; // Skip translation since it's already cached
        }

        // Use the current settings for translation, not the hardcoded ones
        timingBreakdown.translationStart = performance.now();
        const settings = await settingsPromise; // Wait for settings to be loaded
        let translationSuccessful = false;

        // First try the primary server with HTTPS
        try {
            const primaryAddress = "https://otso.veistera.com/translate";
            console.debug('%c LatexToCalc [BG] › %cAttempting translation with primary server', 'color:#2196F3;font-weight:bold', '');
            
            const response = await fetchWithTimeout(primaryAddress, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    ...(chrome.runtime?.id ? {'Origin': chrome.runtime.id} : {})
                },
                mode: 'cors',
                credentials: 'omit',
                body: JSON.stringify({ expression: latexContent, ...settings })
            }, 5000, !connectionWarmedUp); // Pass the cold start flag to fetchWithTimeout
            
            // Mark connection as warmed up after first successful request
            connectionWarmedUp = true;
            
            if (!response.ok) throw new Error(`Bad response from ${primaryAddress}`);
            const data = await response.json();
            
            timingBreakdown.translationEnd = performance.now();
            const calculatorSyntax = data.result;
            
            copyTranslationToClipboard(calculatorSyntax, true); // Pass true to indicate timing should be measured
            translationSuccessful = true;
            lastInputLatex = latexContent;
            lastOutputCalcSyntax = calculatorSyntax;
            console.log('%c LatexToCalc [BG] › %cTranslated text: %c' + calculatorSyntax, 'color:#2196F3;font-weight:bold', '', 'font-weight:bold;color:#009688');
            
            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = activeTabs[0];
            if (activeTab) {
                chrome.tabs.sendMessage(activeTab.id, { 
                    type: 'TRANSLATION_COMPLETED',
                    totalTime: Math.round(timingBreakdown.translationEnd - timingBreakdown.translationStart)
                });
            }
            return;
        } catch (primaryError) {
            console.debug('%c LatexToCalc [BG] › %cPrimary server failed: %c' + primaryError, 'color:#2196F3;font-weight:bold', '', 'color:#F44336');
            // Continue with fallback servers if primary fails
        }
        
        // Fallback to trying all other combinations
        const serverAddresses = ["otso.veistera.com", "129.151.205.209"];
        const protocols = ['https://', 'http://'];
        const translationRequests = [];

        for (const address of serverAddresses) {
            for (const protocol of protocols) {
                // Skip the primary server as we already tried it
                if (protocol === 'https://' && address === "otso.veistera.com") continue;
                
                const serverUrl = `${protocol}${address}`;
                const request = fetchWithTimeout(`${serverUrl}/translate`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        ...(chrome.runtime?.id ? {'Origin': chrome.runtime.id} : {})
                    },
                    mode: 'cors',
                    credentials: 'omit',
                    body: JSON.stringify({ expression: latexContent, ...settings })
                }, 5000).then(async (response) => {
                    if (!response.ok) throw new Error(`Bad response from ${serverUrl}`);
                    const data = await response.json();
                    return { calculatorSyntax: data.result, source: serverUrl };
                }).catch(error => {
                    console.debug('%c LatexToCalc [BG] › %cError from %c' + serverUrl + ': %c' + error.message, 'color:#2196F3;font-weight:bold', '', 'font-weight:bold', 'color:#F44336');
                    throw error;
                });

                translationRequests.push(request);
            }
        }

        try {
            const { calculatorSyntax, source } = await Promise.any(translationRequests);
            timingBreakdown.translationEnd = performance.now();
            copyTranslationToClipboard(calculatorSyntax, true);
            translationSuccessful = true;
            lastInputLatex = latexContent;
            lastOutputCalcSyntax = calculatorSyntax;
            console.debug('%c LatexToCalc [BG] › %cTranslation successful from fallback %c' + source + ': %c' + calculatorSyntax, 'color:#2196F3;font-weight:bold', '', 'font-weight:bold', 'font-style:italic;color:#009688');
            
            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = activeTabs[0];
            if (activeTab) {
                chrome.tabs.sendMessage(activeTab.id, { 
                    type: 'TRANSLATION_COMPLETED',
                    totalTime: Math.round(timingBreakdown.translationEnd - timingBreakdown.translationStart)
                });
            }
            return;
        } catch (error) {
            console.debug('%c LatexToCalc [BG] › %cAll translation attempts failed: %c' + error, 'color:#2196F3;font-weight:bold', '', 'color:#F44336');
        }

        if (!translationSuccessful) {
            const hasInternet = await checkInternetConnection();
            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = activeTabs[0];

            if (!hasInternet) {
                console.error('%c LatexToCalc [BG] › %cNo internet connection', 'color:#2196F3;font-weight:bold', 'color:#F44336');
                showErrorPopupInTab(activeTab.id, 'No internet connection. Please check your Wi-Fi.');
            } else {
                console.error('%c LatexToCalc [BG] › %cFailed to translate latex', 'color:#2196F3;font-weight:bold', 'color:#F44336');
                showErrorPopupInTab(activeTab.id, 'Failed to translate LaTeX, the server is down.');
            }
        }
    }
});

// Function to log the complete timing breakdown
function logTimingBreakdown() {
    // Only log if we have complete timing information
    if (!timingBreakdown.clipboardWritten) {
        console.debug('%c LatexToCalc [BG] › %cTiming breakdown incomplete, waiting for clipboard operation', 'color:#2196F3;font-weight:bold', '');
        return;
    }
    
    const total = Math.round(timingBreakdown.clipboardWritten - timingBreakdown.keypress);
    const latexExtraction = Math.round(timingBreakdown.latexReceived - timingBreakdown.keypress);
    const translation = Math.round(timingBreakdown.translationEnd - timingBreakdown.translationStart);
    const clipboardWrite = Math.round(timingBreakdown.clipboardWritten - timingBreakdown.translationEnd);
    
    // Ensure all values are positive
    if (total <= 0 || latexExtraction < 0 || translation < 0 || clipboardWrite < 0) {
        console.warn('%c LatexToCalc [BG] › %cInvalid timing detected, skipping breakdown', 'color:#2196F3;font-weight:bold', 'color:#FF9800');
        return;
    }
    
    // Calculate percentages
    const latexExtractionPercent = Math.round(latexExtraction/total*100);
    const translationPercent = Math.round(translation/total*100);
    const clipboardWritePercent = Math.round(clipboardWrite/total*100);
    
    // Get color styles based on percentage contribution
    const latexExtractionColor = getColorForPercentage(latexExtractionPercent);
    const translationColor = getColorForPercentage(translationPercent);
    const clipboardWriteColor = getColorForPercentage(clipboardWritePercent);
    
    // Log with colored millisecond values
    console.debug(
        `%c LatexToCalc [BG] › %c⏱ Timing breakdown (total: ${total} ms):
    - LaTeX extraction: %c${latexExtraction.toString().padStart(3)} ms%c (${latexExtractionPercent}%)
    - Translation:      %c${translation.toString().padStart(3)} ms%c (${translationPercent}%)
    - Clipboard:        %c${clipboardWrite.toString().padStart(3)} ms%c (${clipboardWritePercent}%)`,
        'color:#2196F3;font-weight:bold', '',
        // Style arguments for each %c placeholder
        latexExtractionColor, "color: inherit",
        translationColor, "color: inherit",
        clipboardWriteColor, "color: inherit"
    );
    
    // Send timing to the active tab for popup display
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, { 
                type: 'TRANSLATION_COMPLETED',
                totalTime: total
            });
        }
    });
    
    // Reset timing data to prevent double-reporting
    timingBreakdown = {};
}

// Helper function to get color based on percentage
function getColorForPercentage(percentage) {
    // Linear color gradient from green to red based on percentage
    // Convert percentage to a hue value (120° = green, 0° = red)
    const hue = Math.max(0, 120 - (percentage * 1.2)); // Scaled to give a nice gradient
    return `color: hsl(${hue}, 80%, 45%)`;
}

// Open instructions on install
chrome.runtime.onInstalled.addListener(() => {
    const urlToOpen = chrome.runtime.getURL("popup.html"); 
    chrome.tabs.create({ url: urlToOpen });
});

// Function to inject the clipboard copy operation into the active tab
function copyTranslationToClipboard(text, trackTiming = false) {
    // Query the active tab in the current window
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs.length === 0) {
            console.error('%c LatexToCalc [BG] › %cNo active tab found', 'color:#2196F3;font-weight:bold', 'color:#F44336');
            return;
        }

        console.debug('%c LatexToCalc [BG] › %cCopying translation to clipboard', 'color:#2196F3;font-weight:bold', '');
        // Inject and execute the performClipboardCopy function in the active tab
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: performClipboardCopy,
            args: [text, trackTiming]
        }, (result) => {
            if (chrome.runtime.lastError) {
                console.error('%c LatexToCalc [BG] › %cError injecting script: %c' + chrome.runtime.lastError.message, 'color:#2196F3;font-weight:bold', '', 'color:#F44336');
            } else {
                console.debug('%c LatexToCalc [BG] › %cCopied to clipboard', 'color:#2196F3;font-weight:bold', '');
                
                if (trackTiming && result && result[0] && result[0].result) {
                    // Only update timing data if we received a valid result
                    const clipboardTime = performance.now();
                    
                    // Only set this if we haven't already logged the timing
                    if (!timingBreakdown.clipboardWritten) {
                        timingBreakdown.clipboardWritten = clipboardTime;
                        // Now log the final breakdown after we have all the data
                        logTimingBreakdown();
                    }
                }
            }
        });
    });
}

// This function is executed in the tab's context to copy text to the clipboard
function performClipboardCopy(text, trackTiming) {
    const startTime = performance.now();
    return navigator.clipboard.writeText(text).then(() => {
        const endTime = performance.now();
        console.log('%c LatexToCalc [BG] › %cCopied to clipboard: %c' + text, 'color:#2196F3;font-weight:bold', '', 'font-style:italic;font-weight:bold');
        return trackTiming ? { written: true, time: endTime } : true;
    }).catch(err => {
        console.error('%c LatexToCalc [BG] › %cFailed to copy text: %c' + err, 'color:#2196F3;font-weight:bold', '', 'color:#F44336');
        return false;
    });
}

// Function to send fetch request with timeout
async function fetchWithTimeout(url, options, timeout, isColdStart = false) {
    const fetchStartTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        // Add cold emoji if this is a cold start
        const coldIndicator = isColdStart ? " ❄️" : "";
        console.debug('%c LatexToCalc [BG] › %cStarting fetch to %c' + url + coldIndicator, 'color:#2196F3;font-weight:bold', '', 'font-style:italic');
        
        const response = await fetch(url, { ...options, signal: controller.signal });
        
        // Get the response body as text and parse it into JSON 
        const responseText = await response.text();
        const fetchEndTime = performance.now();
        const fetchDuration = Math.round(fetchEndTime - fetchStartTime);
        console.debug('%c LatexToCalc [BG] › %cFetch completed in %c' + fetchDuration + ' ms', 'color:#2196F3;font-weight:bold', '', 'font-weight:bold');
        
        // Create a new response with the parsed text
        return new Response(responseText, {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText
        });
    } catch (error) {
        const fetchDuration = Math.round(performance.now() - fetchStartTime);
        console.debug('%c LatexToCalc [BG] › %cFetch failed after %c' + fetchDuration + ' ms: %c' + error, 'color:#2196F3;font-weight:bold', '', 'font-weight:bold', 'color:#F44336');
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}
