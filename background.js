//background.js

// Import timing module
importScripts('timing.js');

// Initialize cachedSettings variable if it doesn't exist
let cachedSettings = null;

// Function to get the latest settings from storage
function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get("settings", (data) => {
            if (data.settings) {
                cachedSettings = data.settings;
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
                    cachedSettings = defaultSettings;
                    resolve(defaultSettings);
                });
            }
        });
    });
}

// Initial settings load
getSettings().then(() => {
    console.debug('%c LatexToCalc [BG] › %cSettings loaded from storage', 'color:#2196F3;font-weight:bold', '');
});

// Create a global variable to hold the controller for the main operation
let mainAbortController;
let processStartTime;
// Global cache for the most recent input and translated output
let lastInputLatex = '';
let lastOutputCalcSyntax = '';

// Connection warmup flag to track if we've made the first request
let connectionWarmedUp = false;

// Update the logToActiveTab function to support passing console style arguments
function logToActiveTab(message, type = 'info', skipContentLog = false, consoleArgs = []) {
    // Only send to content script if not explicitly skipped
    if (!skipContentLog) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { 
                    type: 'LOG_MESSAGE', 
                    logType: type,
                    message: message,
                    consoleArgs: consoleArgs // Add any console style args
                });
            }
        });
    }
    
    // Always log to background console with appropriate style
    const styles = {
        info: 'color:#2196F3;font-weight:bold',
        warn: 'color:#FF9800;font-weight:bold',
        error: 'color:#F44336;font-weight:bold',
        success: 'color:#4CAF50;font-weight:bold',
        verbose: 'color:#607D8B;font-weight:bold'
    };
    
    // Use the right console method based on type
    if (type === 'verbose') {
        console.debug(`%c LatexToCalc [BG] › %c${message}`, styles.verbose || styles.info, '', ...consoleArgs);
    } else if (type === 'warn') {
        console.warn(`%c LatexToCalc [BG] › %c${message}`, styles[type] || styles.info, '', ...consoleArgs);
    } else if (type === 'error') {
        console.error(`%c LatexToCalc [BG] › %c${message}`, styles[type] || styles.info, '', ...consoleArgs);
    } else {
        console.log(`%c LatexToCalc [BG] › %c${message}`, styles[type] || styles.info, '', ...consoleArgs);
    }
}

// Add this helper function to format active settings
function getActiveSettingsString(settings) {
    const settingMappings = {
        'TI_on': 'TI',
        'SC_on': 'SC',
        'constants_on': 'CONST',
        'coulomb_on': 'k',
        'e_on': 'e',
        'i_on': 'i',
        'g_on': 'g'
    };
    
    // Filter only settings that are enabled (true)
    const activeSettings = [];
    for (const key in settings) {
        if (settings[key] === true && settingMappings[key]) {
            activeSettings.push(settingMappings[key]);
        }
    }
    
    return activeSettings.length > 0 ? activeSettings.join('+') : 'none';
}

// Update settings string generation while removing loading time display
function logActiveSettings(settings) {
    const activeSettingsStr = getActiveSettingsString(settings);
    logToActiveTab(`Using settings: ${activeSettingsStr}`, 'info');
}

// Warm up the connection and translation engine on extension load
async function warmupTranslationEngine() {
    const warmupStartTime = performance.now();
    console.debug('%c LatexToCalc [BG] › %cStarting translation engine warmup...', 'color:#2196F3;font-weight:bold', '');
    
    try {
        // Load settings before making the warmup request
        const settings = await getSettings();
        
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

// Listen for settings update message from popup with improved logging
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "SETTINGS_UPDATED") {
        const oldSettings = cachedSettings ? {...cachedSettings} : null;
        chrome.storage.sync.set({ settings: request.settings }, () => {
            cachedSettings = request.settings;
            
            // Generate detailed diff of what changed
            if (oldSettings) {
                const changes = [];
                for (const key in request.settings) {
                    if (oldSettings[key] !== request.settings[key]) {
                        const settingName = {
                            'TI_on': 'TI mode',
                            'SC_on': 'Scientific mode',
                            'constants_on': 'Constants',
                            'coulomb_on': 'Coulomb constant (k)',
                            'e_on': 'Euler\'s number (e)',
                            'i_on': 'Imaginary unit (i)',
                            'g_on': 'Gravitational constant (g)'
                        }[key] || key;
                        
                        changes.push(`${settingName}: ${oldSettings[key]} → ${request.settings[key]}`);
                    }
                }
                
                if (changes.length > 0) {
                    logToActiveTab(`Settings updated: ${changes.join(', ')}`, 'info');
                } else {
                    logToActiveTab('Settings saved (no changes)', 'info');
                }
            } else {
                logToActiveTab('Settings initialized', 'info');
            }
        });
    }
});

// Listen for the command to translate clipboard content
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'translate-clipboard') {
        logToActiveTab('Translation command received', 'verbose');
        processStartTime = performance.now();
        
        // Create a unique request ID to track this specific request
        const requestId = Date.now() + '_' + Math.random();

        // Start timing for this request
        timingTracker.startRequest(requestId);

        // Clean up old controller and create new one
        if (mainAbortController) {
            mainAbortController.abort();
            mainAbortController = null; // Clean up reference
            console.debug('%c LatexToCalc [BG] › %cAborted previous translation request', 'color:#2196F3;font-weight:bold', '');
        }
        mainAbortController = new AbortController();

        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = activeTabs[0];
        if (activeTab) {
            timingTracker.mark(requestId, 'contentScriptStart');
            console.debug('%c LatexToCalc [BG] › %cExecuting content script in tab %c' + activeTab.id, 'color:#2196F3;font-weight:bold', '', 'font-weight:bold');
            chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                function: async (reqId) => {
                    const latexContent = await extractLatexContent(); // Renamed function from getTextFromIframe
                    if (latexContent && latexContent.trim() !== "") {
                        chrome.runtime.sendMessage({ type: "LATEX_EXTRACTED", latexContent: latexContent, requestId: reqId });
                    } else {
                        try {
                            const textFromClipboard = await navigator.clipboard.readText();
                            chrome.runtime.sendMessage({ type: "LATEX_EXTRACTED", latexContent: textFromClipboard, requestId: reqId });
                        } catch (error) {
                            console.error('%c LatexToCalc [BG] › %cError reading from clipboard: %c' + error, 'color:#2196F3;font-weight:bold', '', 'color:#F44336');
                            chrome.runtime.sendMessage({
                                type: 'SHOW_ERROR_POPUP',
                                message: 'Failed to read from clipboard. Please try again.'
                            });
                        }
                    }
                },
                args: [requestId]
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
        const requestId = request.requestId || 'default';
        timingTracker.mark(requestId, 'latexReceived');
        
        // Print the original LaTeX before translation (normal log)
        logToActiveTab(`Source LaTeX: ${latexContent}`, 'info');
        
        // Log whether this is the first request after extension load
        if (!connectionWarmedUp) {
            console.debug('%c LatexToCalc [BG] › %cFirst translation request - server may need to initialize', 'color:#2196F3;font-weight:bold', 'color:#FF9800');
        }

        // Check if the latex content is the same as the last input or last output (cache check)
        if (latexContent === lastInputLatex || latexContent === lastOutputCalcSyntax) {
            console.log('%c LatexToCalc [BG] › %cUsing cached translation', 'color:#2196F3;font-weight:bold', '');
            // Use cached translation
            timingTracker.mark(requestId, 'translationStart');
            timingTracker.mark(requestId, 'translationEnd');
            copyTranslationToClipboard(lastOutputCalcSyntax, true, requestId); // Pass requestId for timing tracking

            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = activeTabs[0];
            if (activeTab) {
                // Send a message to the active tab to show the "Translated" popup
                chrome.tabs.sendMessage(activeTab.id, { type: 'TRANSLATION_COMPLETED', totalTime: 0 });
            }
            return; // Skip translation since it's already cached
        }

        // Get the latest settings for each translation request
        timingTracker.mark(requestId, 'settingsLoadStart');
        const settings = await getSettings(); // Get fresh settings
        timingTracker.mark(requestId, 'settingsLoadEnd');
        
        // Log active settings without showing load time
        logActiveSettings(settings);
        
        // JSON serialization timing
        timingTracker.mark(requestId, 'jsonSerializeStart');
        const requestBody = JSON.stringify({ expression: latexContent, ...settings });
        timingTracker.mark(requestId, 'jsonSerializeEnd');

        // Start the translation after settings are loaded
        timingTracker.mark(requestId, 'translationStart');
        let translationSuccessful = false;

        // First try the primary server with HTTPS
        try {
            const primaryAddress = "https://otso.veistera.com/translate";
            logToActiveTab('Attempting translation with primary server', 'verbose');
            
            const response = await fetchWithTimeout(primaryAddress, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(chrome.runtime?.id ? {'Origin': chrome.runtime.id} : {})
                },
                mode: 'cors',
                credentials: 'omit',
                body: requestBody
            }, 5000, !connectionWarmedUp, requestId); // Pass the cold start flag and requestId to fetchWithTimeout
            
            // Mark connection as warmed up after first successful request
            connectionWarmedUp = true;
            
            if (!response.ok) throw new Error(`Bad response from ${primaryAddress}`);
            const data = await response.json();
            
            timingTracker.mark(requestId, 'translationEnd');
            const calculatorSyntax = data.result;
            
            // Get result and copy to clipboard - measure each step precisely
            timingTracker.mark(requestId, 'tabQueryStart');
            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            timingTracker.mark(requestId, 'tabQueryEnd');

            copyTranslationToClipboard(calculatorSyntax, true, requestId); // Pass requestId for timing tracking
            translationSuccessful = true;
            lastInputLatex = latexContent;
            lastOutputCalcSyntax = calculatorSyntax;
            logToActiveTab(`Translated: ${calculatorSyntax}`, 'success');
            
            const activeTab = activeTabs[0];
            if (activeTab) {
                const timing = timingTracker.getTiming(requestId);
                chrome.tabs.sendMessage(activeTab.id, {
                    type: 'TRANSLATION_COMPLETED',
                    totalTime: timingTracker.round(timing.translationEnd - timing.translationStart)
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
                    body: requestBody
                }, 5000, false, requestId).then(async (response) => {
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
            timingTracker.mark(requestId, 'translationEnd');
            copyTranslationToClipboard(calculatorSyntax, true, requestId);
            translationSuccessful = true;
            lastInputLatex = latexContent;
            lastOutputCalcSyntax = calculatorSyntax;
            console.debug('%c LatexToCalc [BG] › %cTranslation successful from fallback %c' + source + ': %c' + calculatorSyntax, 'color:#2196F3;font-weight:bold', '', 'font-weight:bold', 'font-style:italic;color:#009688');
            
            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = activeTabs[0];
            if (activeTab) {
                const timing = timingTracker.getTiming(requestId);
                chrome.tabs.sendMessage(activeTab.id, {
                    type: 'TRANSLATION_COMPLETED',
                    totalTime: timingTracker.round(timing.translationEnd - timing.translationStart)
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

// Timing breakdown is now handled by timing.js module

// Open instructions only on first install, not on updates or browser restarts
chrome.runtime.onInstalled.addListener((details) => {
    // Only open popup on fresh install, not on update or browser/extension restart
    if (details.reason === 'install') {
        const urlToOpen = chrome.runtime.getURL("popup.html");
        chrome.tabs.create({ url: urlToOpen });
        console.debug('%c LatexToCalc [BG] › %cOpened popup.html for first-time installation', 'color:#2196F3;font-weight:bold', '');
    } else if (details.reason === 'update') {
        console.debug('%c LatexToCalc [BG] › %cExtension updated to version ' + chrome.runtime.getManifest().version, 'color:#2196F3;font-weight:bold', '');
    }
});

// Update copyTranslationToClipboard to track more detailed clipboard timing
function copyTranslationToClipboard(text, trackTiming = false, requestId = 'default') {
    timingTracker.mark(requestId, 'clipboardPrepStart');
    
    // Query the active tab in the current window
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs.length === 0) {
            console.error('%c LatexToCalc [BG] › %cNo active tab found', 'color:#2196F3;font-weight:bold', 'color:#F44336');
            return;
        }
        
        timingTracker.mark(requestId, 'clipboardPrepEnd');
        console.debug('%c LatexToCalc [BG] › %cCopying translation to clipboard', 'color:#2196F3;font-weight:bold', '');
        
        // Track the clipboard write operation start time
        timingTracker.mark(requestId, 'clipboardWriteStart');
        
        // Inject and execute the performClipboardCopy function in the active tab
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: performClipboardCopy,
            args: [text, trackTiming]
        }, (result) => {
            if (chrome.runtime.lastError) {
                console.error('%c LatexToCalc [BG] › %cError injecting script: %c' + chrome.runtime.lastError.message, 'color:#2196F3;font-weight:bold', '', 'color:#F44336');
                // Notify user of clipboard failure
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'SHOW_ERROR_POPUP',
                    message: 'Failed to copy to clipboard. Please check permissions.'
                });
            } else {
                console.debug('%c LatexToCalc [BG] › %cCopied to clipboard', 'color:#2196F3;font-weight:bold', '');
                
                if (trackTiming && result && result[0] && result[0].result) {
                    // Mark clipboard write completion
                    timingTracker.mark(requestId, 'clipboardWritten');
                    // Log the final timing breakdown
                    timingTracker.logBreakdown(requestId, logToActiveTab);
                } else if (result && result[0] && !result[0].result) {
                    // Clipboard write failed
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'SHOW_ERROR_POPUP',
                        message: 'Failed to write to clipboard. Translation was successful but could not be copied.'
                    });
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
        // We can't use logToActiveTab here since this runs in the content script context
        console.log('%c LatexToCalc [BG] › %cCopied to clipboard: %c' + text, 'color:#2196F3;font-weight:bold', '', 'font-style:italic;font-weight:bold');
        return { result: true, written: true, time: endTime };
    }).catch(err => {
        console.error('%c LatexToCalc [BG] › %cFailed to copy text: %c' + err, 'color:#2196F3;font-weight:bold', '', 'color:#F44336');
        // Return detailed error info
        return { result: false, error: err.message || 'Unknown clipboard error' };
    });
}

// Update fetchWithTimeout for consistent precision
async function fetchWithTimeout(url, options, timeout, isColdStart = false, requestId = 'default') {
    const fetchStartTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        // Add cold emoji if this is a cold start
        const coldIndicator = isColdStart ? " ❄️" : "";
        logToActiveTab(`Starting fetch to ${url}${coldIndicator}`, 'verbose');
        
        // Track actual network time with high precision
        timingTracker.mark(requestId, 'networkStart');
        const response = await fetch(url, { ...options, signal: controller.signal });
        timingTracker.mark(requestId, 'networkEnd');
        
        // Track JSON parsing time with high precision
        timingTracker.mark(requestId, 'parseStart');
        const responseText = await response.text();
        timingTracker.mark(requestId, 'parseEnd');
        
        const fetchEndTime = performance.now();
        const fetchDuration = timingTracker.round(fetchEndTime - fetchStartTime);
        const timing = timingTracker.getTiming(requestId);
        const networkTime = timingTracker.round(timing.networkEnd - timing.networkStart);
        const parseTime = timingTracker.round(timing.parseEnd - timing.parseStart);
        
        // Simplified logging with 1 decimal place
        logToActiveTab(`Fetch completed in ${fetchDuration.toFixed(1)} ms (network: ${networkTime.toFixed(1)}ms, parse: ${parseTime.toFixed(1)}ms)`, 'success', true);
        
        // Create a new response with the parsed text
        return new Response(responseText, {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText
        });
    } catch (error) {
        const fetchDuration = timingTracker.round(performance.now() - fetchStartTime);
        logToActiveTab(`Fetch failed after ${fetchDuration.toFixed(1)} ms: ${error}`, 'error');
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}
