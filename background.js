// Create a global variable to hold the controller for the main operation
let mainAbortController;
let processStartTime;

// Listen for the command to translate clipboard content
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'translate-clipboard') {
        // Record the process start time
        processStartTime = performance.now();

        // Check if there's an ongoing main operation, and abort it if exists
        if (mainAbortController) {
            mainAbortController.abort();
        }
        
        // Create a new AbortController for the new main operation
        mainAbortController = new AbortController();

        // Get the active tab
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = activeTabs[0];
        if (activeTab) {
            chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                function: async () => {
                    try {
                        // Read text from clipboard
                        const textFromClipboard = await navigator.clipboard.readText();
                        // Send message to background script with clipboard text
                        chrome.runtime.sendMessage({ type: "GET_CLIPBOARD_TEXT", clipboardText: textFromClipboard });
                    } catch (error) {
                        console.log('Error reading from clipboard:', error);
                        alert('Failed to read from clipboard. Please try again.');
                    }
                }
            });
        } else {
            console.log('No active tab found.');
            alert('Click on a tab first.');
        }
    }
});

// Listen for messages from the script above, with clipboard text
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.type === "GET_CLIPBOARD_TEXT") {
        // Extract clipboard text from message
        const clipboardText = request.clipboardText;
        console.log("Clipboard text:", clipboardText);
        
        // Multiple backup addresses for extra reliability
        const addresses = ["otso.veistera.com", "otsoveistera.xyz", "207.127.91.252", "207.127.91.252:5002"];
       
        // Define HTTP schemes to try (in case of SSL certification issues or other trouble)
        const schemes = ['https://', 'http://', ''];

        let translationSuccessful = false;
        let addressAvailable = false;

        // Loop through each scheme and address combination 
        for (const address of addresses) {
            addressAvailable = false; // Reset the flag for each address
            console.log(`Trying ${address}:`)
            for (const scheme of schemes) {
                const fullAddress = scheme + address;
                console.log(`   with ${scheme ? scheme.replace(':', '').replace('//', '') : 'no scheme'}`);
                try {
                    // Start timer for fetch request
                    const fetchStart = performance.now();

                    // Send fetch request with a 5-second timeout
                    const response = await fetchWithTimeout(`${fullAddress}/translate`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ expression: clipboardText })
                    }, 5000); // 5 seconds timeout
                    
                    // End timer for fetch request
                    const fetchEnd = performance.now();
                    console.log(`Fetch request took ${(fetchEnd - fetchStart).toFixed(0)} ms`);

                    if (response.ok) {
                        // If translation is successful, extract the translated text
                        const data = await response.json();
                        const translatedText = data.result;

                        // Add translated text to clipboard
                        addToClipboard(translatedText);
                        translationSuccessful = true;
                        addressAvailable = true;

                        // End the process time measurement
                        const timetaken = performance.now() - processStartTime;

                        console.log(`Translation with ${fullAddress} took ${timetaken.toFixed(0)} ms: ${translatedText}`);
                        return; // Exit the function if successful
                    } else {
                        console.log(`Translation server error, response not "ok": ${response.statusText} at ${fullAddress}/translate`);
                    }
                } catch (error) {
                    // Check if the error is due to aborting the request
                    if (error.name === 'AbortError') {
                        console.log('Request aborted.');
                    } else {
                        console.log(`${error.message}`);
                    }
                }
            }
            // If the address is not available, print "unavailable"
            if (!addressAvailable) {
                console.log(`${address} unavailable`);
            }
        }

        // If translation is still not successful, log an error and alert the user
        if (!translationSuccessful) {
            // Log error if translation fails
            console.error('Failed to translate clipboard');
            // Display alert if translation fails
            alert('Failed to translate clipboard. Please try again later or contact otso@veistera.com');
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
