//contentscript.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_CLIPBOARD_TEXT") {
        // Read text from the clipboard
        navigator.clipboard.readText()
            .then((clipboardText) => {
                // Send the clipboard text to the background script
                chrome.runtime.sendMessage({ type: "GET_CLIPBOARD_TEXT", clipboardText: clipboardText });
            })
            .catch((error) => {
                console.error('Error reading from clipboard:', error);
            });
    }
});
