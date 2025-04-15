//background.js

// Default settings
let settingsPromise = new Promise((resolve) => {
    chrome.storage.sync.get("settings", (data) => {
        if (data.settings) {
            console.debug("Settings loaded from storage:", data.settings);
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
                console.debug("Default settings saved to storage:", defaultSettings);
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
let lastInputText = '';
let lastOutputText = '';

// Connection warmup flag to track if we've made the first request
let connectionWarmedUp = false;

// Warm up the connection and translation engine on extension load
async function warmupConnection() {
    const warmupStartTime = performance.now();
    console.debug("Starting translation engine warmup...");
    
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
            console.debug(`Translation engine connection warmed up in ${warmupTime} ms`);
        } else {
            throw new Error("Server returned an error");
        }
    } catch (error) {
        const failTime = Math.round(performance.now() - warmupStartTime);
        console.debug(`Translation engine warmup failed after ${failTime} ms:`, error);
    }
}

// Call the warmup function when the extension loads
// We'll delay it slightly to ensure settings are loaded
setTimeout(warmupConnection, 500);

// Function to send a message to the active tab to show the popup
function showPopupInTab(tabId, message) {
    chrome.tabs.sendMessage(tabId, { type: 'SHOW_POPUP', message: message });
}

// Function to check if the user has an active internet connection
async function checkInternetConnection() {
    try {
        // Using a different URL known not to require CORS
        const response = await fetch('https://ipv4.icanhazip.com/', { method: 'GET' });
        return response.ok;
    } catch (error) {
        console.error('Network error:', error);
        return false;
    }
}

// Listen for settings update message from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "UPDATE_SETTINGS") {
        settings = request.settings;  // Update the settings with the new values
        console.log("Settings updated in background:", settings);
        
        // Optionally store them in chrome storage for persistence
        chrome.storage.sync.set({ settings: settings }, () => {
            console.log("Settings saved in storage.");
        });
    }
});

// Listen for the command to translate clipboard content
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'translate-clipboard') {
        console.log("Translation command received.");
        processStartTime = performance.now();
        timingBreakdown = {
            keypress: processStartTime,
            textReceived: 0,
            translationStart: 0,
            translationEnd: 0,
            clipboardWritten: 0
        };

        if (mainAbortController) {
            mainAbortController.abort();
        }
        mainAbortController = new AbortController();

        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = activeTabs[0];
        if (activeTab) {
            chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                function: async () => {
                    const textFromIframe = await getTextFromIframe(); // Accessing the function from content.js
                    if (textFromIframe && textFromIframe.trim() !== "") {
                        chrome.runtime.sendMessage({ type: "GET_CLIPBOARD_TEXT", clipboardText: textFromIframe });
                    } else {
                        try {
                            const textFromClipboard = await navigator.clipboard.readText();
                            chrome.runtime.sendMessage({ type: "GET_CLIPBOARD_TEXT", clipboardText: textFromClipboard });
                        } catch (error) {
                            console.error('Error reading from clipboard:', error);
                            chrome.runtime.sendMessage({
                                type: 'SHOW_POPUP',
                                message: 'Failed to read from clipboard. Please try again.'
                            });
                        }
                    }
                }
            });
        } else {
            console.warn('No active tab found. Please click on a tab first.');
        }
    }
});

// Listen for messages from the content script (clipboard or iframe text)
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.type === "GET_CLIPBOARD_TEXT") {
        const clipboardText = request.clipboardText;
        timingBreakdown.textReceived = performance.now();
        console.log("LaTeX:", clipboardText);

        // Log whether this is the first request after extension load
        if (!connectionWarmedUp) {
            console.debug("First translation request - server may need to initialize");
        }

        // Check if the clipboard text is the same as the last input or last output (cache check)
        if (clipboardText === lastInputText || clipboardText === lastOutputText) {
            console.log("Using cached translation.");
            // Use cached translation
            timingBreakdown.translationStart = performance.now();
            timingBreakdown.translationEnd = timingBreakdown.translationStart; // No actual translation
            injectCopyTextToClipboard(lastOutputText, true); // Pass true to indicate timing should be measured

            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = activeTabs[0];
            if (activeTab) {
                // Send a message to the active tab to show the "Translated" popup
                chrome.tabs.sendMessage(activeTab.id, { message: 'Translated' });
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
            
            const response = await fetchWithTimeout(primaryAddress, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    ...(chrome.runtime?.id ? {'Origin': chrome.runtime.id} : {})
                },
                mode: 'cors',
                credentials: 'omit',
                body: JSON.stringify({ expression: clipboardText, ...settings })
            }, 5000, !connectionWarmedUp); // Pass the cold start flag to fetchWithTimeout
            
            // Mark connection as warmed up after first successful request
            connectionWarmedUp = true;
            
            if (!response.ok) throw new Error(`Bad response from ${primaryAddress}`);
            const data = await response.json();
            
            timingBreakdown.translationEnd = performance.now();
            injectCopyTextToClipboard(data.result, true); // Pass true to indicate timing should be measured
            translationSuccessful = true;
            lastInputText = clipboardText;
            lastOutputText = data.result;
            console.log(`Translated text: %c${data.result}`, "font-weight: bold");
            
            // Don't call logTimingBreakdown here - it will be called after clipboard operation completes
            
            // More robust checks for Chrome API availability
            if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query && chrome.tabs.sendMessage) {
                try {
                    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (activeTabs && activeTabs.length > 0 && activeTabs[0]) {
                        chrome.tabs.sendMessage(activeTabs[0].id, { message: 'Translated' });
                    }
                } catch (chromeError) {
                    console.error('Error using Chrome API:', chromeError);
                }
            }
            return;
        } catch (primaryError) {
            console.debug("Primary server failed, falling back to alternatives:", primaryError);
            // Continue with fallback servers if primary fails
        }
        
        // Fallback to trying all other combinations
        const addresses = ["otso.veistera.com", "129.151.205.209"];
        const schemes = ['https://', 'http://'];
        const fetchTasks = [];

        for (const address of addresses) {
            for (const scheme of schemes) {
                // Skip the primary server as we already tried it
                if (scheme === 'https://' && address === "otso.veistera.com") continue;
                
                const fullAddress = `${scheme}${address}`;
                const request = fetchWithTimeout(`${fullAddress}/translate`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        ...(chrome.runtime?.id ? {'Origin': chrome.runtime.id} : {})
                    },
                    mode: 'cors',
                    credentials: 'omit',
                    body: JSON.stringify({ expression: clipboardText, ...settings })
                }, 5000).then(async (response) => {
                    if (!response.ok) throw new Error(`Bad response from ${fullAddress}`);
                    const data = await response.json();
                    return { translatedText: data.result, source: fullAddress };
                }).catch(error => {
                    console.debug(`Error from ${fullAddress}: ${error.message}`);
                    throw error;
                });

                fetchTasks.push(request);
            }
        }

        try {
            const { translatedText, source } = await Promise.any(fetchTasks);
            timingBreakdown.translationEnd = performance.now();
            injectCopyTextToClipboard(translatedText, true);
            translationSuccessful = true;
            lastInputText = clipboardText;
            lastOutputText = translatedText;
            console.debug(`Translation successful from fallback ${source}: ${translatedText}`);
            
            // Again, don't call logTimingBreakdown here
            
            // More robust checks for Chrome API availability
            if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query && chrome.tabs.sendMessage) {
                try {
                    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (activeTabs && activeTabs.length > 0 && activeTabs[0]) {
                        chrome.tabs.sendMessage(activeTabs[0].id, { message: 'Translated' });
                    }
                } catch (chromeError) {
                    console.error('Error using Chrome API:', chromeError);
                }
            }
            return;
        } catch (error) {
            console.debug('All translation attempts failed:', error);
        }

        if (!translationSuccessful) {
            const hasInternet = await checkInternetConnection();
            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = activeTabs[0];

            if (!hasInternet) {
                console.error('No internet connection.');
                showPopupInTab(activeTab.id, 'No internet connection. Please check your Wi-Fi.');
            } else {
                console.error('Failed to translate clipboard');
                showPopupInTab(activeTab.id, 'Failed to translate clipboard, the server is down.');
            }
        }
    }
});

// Function to log the complete timing breakdown
function logTimingBreakdown() {
    // Only log if we have complete timing information
    if (!timingBreakdown.clipboardWritten) {
        console.debug("Timing breakdown incomplete, waiting for clipboard operation to complete");
        return;
    }
    
    const total = Math.round(timingBreakdown.clipboardWritten - timingBreakdown.keypress);
    const textFetch = Math.round(timingBreakdown.textReceived - timingBreakdown.keypress);
    const translation = Math.round(timingBreakdown.translationEnd - timingBreakdown.translationStart);
    const clipboardWrite = Math.round(timingBreakdown.clipboardWritten - timingBreakdown.translationEnd);
    
    // Ensure all values are positive
    if (total <= 0 || textFetch < 0 || translation < 0 || clipboardWrite < 0) {
        console.warn("Invalid timing detected, skipping breakdown");
        return;
    }
    
    // Calculate percentages
    const textFetchPercent = Math.round(textFetch/total*100);
    const translationPercent = Math.round(translation/total*100);
    const clipboardWritePercent = Math.round(clipboardWrite/total*100);
    
    // Get color styles based on percentage contribution
    const textFetchColor = getColorForPercentage(textFetchPercent);
    const translationColor = getColorForPercentage(translationPercent);
    const clipboardWriteColor = getColorForPercentage(clipboardWritePercent);
    
    // Log with colored millisecond values
    console.debug(
        `⏱ Timing breakdown (total: ${total} ms):
    - Text fetch:     %c${textFetch.toString().padStart(3)} ms%c (${textFetchPercent}%)
    - Translation:    %c${translation.toString().padStart(3)} ms%c (${translationPercent}%)
    - Clipboard:      %c${clipboardWrite.toString().padStart(3)} ms%c (${clipboardWritePercent}%)`,
        // Style arguments for each %c placeholder
        textFetchColor, "color: inherit",
        translationColor, "color: inherit",
        clipboardWriteColor, "color: inherit"
    );
    
    // Send timing to the active tab for popup display
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, { 
                message: 'Translated',
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
function injectCopyTextToClipboard(text, trackTiming = false) {
    // Query the active tab in the current window
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs.length === 0) {
            console.error('No active tab found');
            return;
        }

        // Inject and execute the performClipboardCopy function in the active tab
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: performClipboardCopy,
            args: [text, trackTiming]
        }, (result) => {
            if (chrome.runtime.lastError) {
                console.error('Error injecting script:', chrome.runtime.lastError);
            } else {
                console.log('Copied to clipboard');
                
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
        console.log(`Text copied to clipboard in ${Math.round(endTime - startTime)} ms`);
        return trackTiming ? { written: true, time: endTime } : true;
    }).catch(err => {
        console.error('Failed to copy text:', err);
        return false;
    });
}

// Example usage

// Function to send fetch request with timeout
async function fetchWithTimeout(url, options, timeout, isColdStart = false) {
    const fetchStartTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        // Add cold emoji if this is a cold start
        const coldIndicator = isColdStart ? " ❄️" : "";
        console.debug(`Starting fetch to ${url}${coldIndicator}`);
        
        const response = await fetch(url, { ...options, signal: controller.signal });
        
        // Get the response body as text and parse it into JSON 
        const responseText = await response.text();
        const fetchEndTime = performance.now();
        
        // Create a new response with the parsed text
        return new Response(responseText, {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText
        });
    } finally {
        clearTimeout(timeoutId);
    }
}
