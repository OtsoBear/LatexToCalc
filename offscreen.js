//offscreen.js

console.log("Offscreen script loaded.");

// Once the message has been posted from the service worker, checks are made to
// confirm the message type and target before proceeding. This is so that the
// module can easily be adapted into existing workflows where secondary uses for
// the document (or alternate offscreen documents) might be implemented.
chrome.runtime.onMessage.addListener(handleMessages);

// This function performs basic filtering and error checking on messages before
// dispatching the
// message to a more specific message handler.
async function handleMessages(message) {
  console.log("Received message:", message);

  // Return early if this message isn't meant for the offscreen document.
  if (message.target !== 'offscreen-doc') {
    console.log("Message not intended for offscreen document.");
    return;
  }

  // Dispatch the message to an appropriate handler.
  switch (message.type) {
    case 'copy-data-to-clipboard':
      console.log("Copying data to clipboard:", message.data);
      handleClipboardWrite(message.data);
      break;
    default:
      console.warn(`Unexpected message type received: '${message.type}'.`);
  }
}

// We use a <textarea> element for two main reasons:
//  1. preserve the formatting of multiline text,
//  2. select the node's content using this element's `.select()` method.
const textEl = document.querySelector('#text');

// Use the offscreen document's `document` interface to write a new value to the
// system clipboard.
//
// At the time this demo was created (Jan 2023) the `navigator.clipboard` API
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

    // `document.execCommand('copy')` works against the user's selection in a web
    // page. As such, we must insert the string we want to copy to the web page
    // and to select that content in the page before calling `execCommand()`.
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
