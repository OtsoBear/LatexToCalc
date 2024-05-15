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
                        console.error('Error reading from clipboard:', error);
                    }
                }
            });
        } else {
            console.error('No active tab found.');
        }
    }
});


chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.type === "GET_CLIPBOARD_TEXT") {
        const clipboardText = request.clipboardText;
        console.log("Clipboard text:", clipboardText);
        fetch('https://otsoveistera.xyz/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ expression: clipboardText })
        })
        .then(response => response.json())
        .then(data => {
            const translatedText = data.result;
            console.log('Translated text:', translatedText);
            addToClipboard(translatedText);
        })
        .catch(error => {
            console.error('Translation server error:', error);
        });
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
