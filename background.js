chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'translate-clipboard') {
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
                        alert('Failed to read from clipboard. Please try again.');
                    }
                }
            });
        } else {
            console.log('No active tab found.');
            alert('No active tab found.');
        }
    }
});

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.type === "GET_CLIPBOARD_TEXT") {
        const clipboardText = request.clipboardText;
        console.log("Clipboard text:", clipboardText);
        
        const serverAddress = "otso.veistera.com";
        const secondaryAddresses = ["207.127.91.252", "otsoveistera.xyz", "207.127.91.252:5002"];
        
        const addresses = [serverAddress].concat(secondaryAddresses);
        const schemes = ['https://', 'http://', ''];

        let translationSuccessful = false;

        for (const address of addresses) {
            for (const scheme of schemes) {
                const fullAddress = scheme + address;
                console.log(`Attempting translation with ${fullAddress}/translate`);
                try {
                    const response = await fetch(`${fullAddress}/translate`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ expression: clipboardText })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        const translatedText = data.result;
                        console.log('Translation successful:', translatedText);
                        addToClipboard(translatedText);
                        translationSuccessful = true;
                        return; // Exit the function if successful
                    } else {
                        console.log(`Translation server error: ${response.statusText} at ${fullAddress}/translate`);
                    }
                } catch (error) {
                    console.log(`Translation server error: ${error.message} at ${fullAddress}/translate`);
                }
            }
        }

        if (!translationSuccessful) {
            console.error('Failed to translate clipboard');
            alert('Failed to translate clipboard. Please try again later.');
        }
    }
});

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
