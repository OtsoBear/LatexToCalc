// Create a global variable to hold the controller for the main operation
let mainAbortController;
let processStartTime;
// Function to send a message to the active tab to show the popup
function showPopupInTab(tabId, message) {
    chrome.tabs.sendMessage(tabId, { type: 'SHOW_POPUP', message: message });
}

// Function to check internet connection by trying to connect to google.com
async function checkInternetConnection() {
    try {
        const response = await fetch('https://www.google.com', { method: 'HEAD' });
        return response.ok;
    } catch (error) {
        return false;
    }
}

// Listen for the command to translate clipboard content
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'translate-clipboard') {
        processStartTime = performance.now();
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
                    try {
                        const textFromClipboard = await navigator.clipboard.readText();
                        chrome.runtime.sendMessage({ type: "GET_CLIPBOARD_TEXT", clipboardText: textFromClipboard });
                    } catch (error) {
                        console.log('Error reading from clipboard:', error);
                        showPopupInTab(activeTab.id, 'Failed to read from clipboard. Please try again.');
                    }
                }
            });
        } else {
            console.log('No active tab found.');
            showPopupInTab(activeTab.id, 'Click on a tab first.');
        }
    }
});

// Listen for messages from the script above, with clipboard text
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.type === "GET_CLIPBOARD_TEXT") {
        const clipboardText = request.clipboardText;
        console.log("Clipboard text:", clipboardText);

        const addresses = ["otso.veistera.cdom", "129d.151.205.209"];
        const schemes = ['https://', 'http://'];

        let translationSuccessful = false;
        let addressAvailable = false;

        for (const address of addresses) {
            addressAvailable = false;
            console.log(`Trying ${address}:`)
            for (const scheme of schemes) {
                const fullAddress = scheme + address;
                console.log(`   with ${scheme.replace('://', '')}`);
                try {
                    const fetchStart = performance.now();
                    const response = await fetchWithTimeout(`${fullAddress}/translate`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ expression: clipboardText })
                    }, 5000); 
                    
                    const fetchEnd = performance.now();
                    console.log(`Fetch request took ${(fetchEnd - fetchStart).toFixed(0)} ms`);

                    if (response.ok) {
                        const data = await response.json();
                        const translatedText = data.result;
                        addToClipboard(translatedText);
                        translationSuccessful = true;
                        addressAvailable = true;
                        const timetaken = performance.now() - processStartTime;

                        console.log(`Translation with ${fullAddress} took ${timetaken.toFixed(0)} ms: \"${translatedText}\"`);
                        return;
                    } else {
                        console.log(`Translation server error, response not "ok": ${response.statusText} at ${fullAddress}/translate`);
                    }
                } catch (error) {
                    if (error.name === 'AbortError') {
                        console.log('Request aborted.');
                    } else {
                        console.log(`${error.message}`);
                    }
                }
            }
            if (!addressAvailable) {
                console.log(`${address} unavailable`);
            }
        }

        if (!translationSuccessful) {
            console.error('Failed to translate clipboard');

            // Check internet connection
            const isConnected = await checkInternetConnection();

            if (isConnected) {
                // Server is likely down
                showPopupInTab(sender.tab.id, 'Server is down. Contact otso.veistera@gmail.com');
            } else {
                // No internet connection
                showPopupInTab(sender.tab.id, 'Cannot connect to the internet. Please check your connection.');
            }
        }
    }
});


// Function to add text to clipboard
async function addToClipboard(value) {
    // Create a new offscreen document to write text to clipboard
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.CLIPBOARD],
        justification: 'Write text to the clipboard.'
    });

    // Send message to background script to copy data to clipboard
    chrome.runtime.sendMessage({
        type: 'copy-data-to-clipboard',
        target: 'offscreen-doc',
        data: value
    });
}

// Function to send fetch request with timeout
async function fetchWithTimeout(url, options, timeout) {
    // Create a new AbortController instance for this specific request
    const controller = new AbortController();
    // Set a timeout to abort the request after the specified milliseconds
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        // Send fetch request with AbortController's signal
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        // Clear the timeout
        clearTimeout(timeoutId);
    }
}
