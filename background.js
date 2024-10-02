// Create a global variable to hold the controller for the main operation
let mainAbortController;
let processStartTime;
// Global cache for the most recent input and translated output
let lastInputText = '';
let lastOutputText = '';
// Function to send a message to the active tab to show the popup
function showPopupInTab(tabId, message) {
    chrome.tabs.sendMessage(tabId, { type: 'SHOW_POPUP', message: message });
}

// Listen for the command to translate clipboard content
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'translate-clipboard') {
        console.log("Translate clipboard starts");
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
                                message: 'Failed to read from clipboard. Please try again.'});
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
        console.log("Text to be translated:", clipboardText);

        // Check if the clipboard text is the same as the last input (cache check)
        if (clipboardText === lastInputText) {
            console.log("Using cached translation.");
            // Use cached translation
            await addToClipboard(lastOutputText);

            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = activeTabs[0];
            if (activeTab) {
                // Send a message to the active tab to show the "Translated" popup
                chrome.tabs.sendMessage(activeTab.id, { message: 'Translated' });

            }
            return; // Skip translation since it's already cached
        }



        const addresses = ["otso.veistera.csom", "129.151.205.209s"];
        const schemes = ['https://', 'http://'];

        let translationSuccessful = false;

        for (const address of addresses) {
            for (const scheme of schemes) {
                const fullAddress = `${scheme}${address}`;
                try {
                    const response = await fetchWithTimeout(`${fullAddress}/translate`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ expression: clipboardText })
                    }, 5000);

                    if (response.ok) {
                        const data = await response.json();
                        const translatedText = data.result;


                        // Add translated text to clipboard
                        await addToClipboard(translatedText);
                        translationSuccessful = true;
                        console.log(`Translation successful: ${translatedText}`);

                        // Update the cache with the latest input and output
                        lastInputText = clipboardText;
                        lastOutputText = translatedText;

                        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                        const activeTab = activeTabs[0];

                        if (activeTab) {
                            // Send a message to the active tab to show the "Translated" popup
                            chrome.tabs.sendMessage(activeTab.id, { message: 'Translated' });
                        }
                        return;
                    } else {
                        console.log(`Error: ${response.statusText}`);
                    }
                } catch (error) {
                    console.log(`Fetch error: ${error.message}`);
                }
            }
        }

        if (!translationSuccessful) {
            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = activeTabs[0];
            console.error('Failed to translate clipboard');
            showPopupInTab(activeTab.id, 'Failed to translate clipboard, the server is down.' );
        }
    }
});

// Function to add text to clipboard (same as provided in the original code)
async function addToClipboard(value) {
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.CLIPBOARD],
        justification: 'Write text to the clipboard.'
    });

    chrome.runtime.sendMessage({
        type: 'copy-data-to-clipboard',
        target: 'offscreen-doc',
        data: value
    });
}

// Function to send fetch request with timeout (unchanged)
async function fetchWithTimeout(url, options, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}
