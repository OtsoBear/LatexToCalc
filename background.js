chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'translate-clipboard') {
        const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.scripting.executeScript({
            target: { tabId: activeTab[0].id },
            function: () => {
                const selectedText = window.getSelection().toString();
                chrome.runtime.sendMessage({ type: "GET_SELECTED_TEXT", selectedText: selectedText });
            }
        });
    }
});

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.type === "GET_SELECTED_TEXT") {
        const selectedText = request.selectedText;
        console.log("Selected text:", selectedText);
        fetch('http://129.151.192.203:5002/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ expression: selectedText })
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
