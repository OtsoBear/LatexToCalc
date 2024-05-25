//offscreen.js

//code for pasting data to clipboard

console.log("Offscreen script loaded.");
chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message) {
  console.log("Received message:", message);

  if (message.target !== 'offscreen-doc') {
    console.log("Message not intended for offscreen document.");
    return;
  }
  switch (message.type) {
    case 'copy-data-to-clipboard':
      console.log("Copying data to clipboard:", message.data);
      handleClipboardWrite(message.data);
      break;
    default:
      console.warn(`Unexpected message type received: '${message.type}'.`);
  }
}


const textEl = document.querySelector('#text');

// At the time this was created (Jan 2023) the `navigator.clipboard` API
// requires that the window is focused, but offscreen documents cannot be
// focused. As such, we have to fall back to `document.execCommand()`.
async function handleClipboardWrite(data) {
  try {
    // Error if we received the wrong kind of data.
    if (typeof data !== 'string') {
      console.error("Value provided must be a 'string', got:", typeof data);
      throw new TypeError(
        `Value provided must be a 'string', got '${typeof data}'.`
      );
    }


    textEl.value = data;
    textEl.select();
    document.execCommand('copy');
    console.log("Data copied to clipboard:", data);
  } finally {
    // Job's done! Close the offscreen document.
    console.log("Closing offscreen document.");
    window.close();
  }
}

// offscreen.js
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