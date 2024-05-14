const selectedText = window.getSelection().toString();
chrome.runtime.sendMessage({ type: "GET_SELECTED_TEXT", selectedText: selectedText });
