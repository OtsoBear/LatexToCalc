# LatexToCalc Chrome Extension

LatexToCalc is a [ Chrome extension](https://chromewebstore.google.com/detail/latextocalc/nangjgcfgoikendjhgbcmobbcpijdcjn) that simplifies the process of entering LaTeX-based math formulas into calculators. It captures LaTeX formulas from the clipboard and translates them into a format compatible with calculators like the **TI-Nspire CX CAS**.



---

## How it Works

LatexToCalc allows you to easily convert LaTeX equations into calculator-compatible formats. Here's how it works:

1. **Command Trigger**: Use the keyboard shortcut (`Ctrl + Shift + Z`) to activate the extension. It reads either selected text on a webpage or the content of your clipboard.

2. **Text Extraction**: 
   - If the active page contains a LaTeX formula in a math editor or iframe (e.g., on `kampus.sanomapro.fi`), it extracts the LaTeX directly.
   - If no selection is made, it reads from the clipboard.

3. **Translation**: The LaTeX text is sent to [the backend server](https://github.com/OtsoBear/LatexToCalc-Server), which converts it into a format compatible with calculators like the **TI-Nspire CX CAS**. Cached results are used to avoid unnecessary requests.

4. **Result Injection**: Once translated, the expression is copied back to the clipboard, ready to be pasted into your calculator.

5. **Error Handling**: If translation fails (e.g., no internet connection), the extension provides an error message and offers troubleshooting tips.



## Key Features

- **Clipboard Translation**: Effortlessly convert LaTeX formulas into a format optimized for calculators like TI-Nspire.
- **Cross-Site Support**: Works seamlessly with math websites, including those used in Finnish high school curriculum.
- **Cache and Retry Logic**: Implements a caching mechanism for recent translations and automatic retries to ensure translations are successful even with server downtime.
  

## Error Management

LatexToCalc includes a robust error management system that ensures smooth user experience even when issues occur:

- **Translation Failures**: If a LaTeX formula cannot be translated, the extension notifies the user with an error message.
- **Server Downtime**: If the translation server is unavailable, the extension retries the request with alternative servers.
- **Performance Logging**: Detailed logs (usually hidden) provide insight into the translation process, helping identify potential bottlenecks and ensure smooth performance.

---

## Backend Overview

The translation engine powering LatexToCalc is [LatexToCalc-Server](https://github.com/OtsoBear/LatexToCalc-Server), a Flask-based web application that handles requests for LaTeX translation, logging, and performance optimization.

- **Flask Framework**: A lightweight web application optimized for low-latency LaTeX translation using a REST API.
- **Multi-Endpoint Architecture**: Dedicated endpoints for translation, logging performance, and managing CORS preflight requests.
- **Parallel Processing**: Utilizes Gunicorn to handle concurrent translation requests efficiently.
- **Error Logging and Management**: Comprehensive error logging and performance tracking enable quick identification and resolution of issues.

## Key Features of the Backend

- **Translation Endpoint (`/translate`)**: Translates LaTeX formulas into a format compatible with calculators like the **TI-Nspire CX CAS**.
- **Flask with Asynchronous Handling**: Ensures high-performance processing by handling multiple requests simultaneously.
- **Automated Setup**: The `start.sh` script simplifies the server environment setup and dependency installation.
- **CI/CD Integration**: **GitHub Actions** runs tests automatically upon code changes, ensuring reliability and rapid detection of issues.
---

## Installation (Chrome Web Store)

1. Visit the [Chrome Web Store page for LatexToCalc ](https://chromewebstore.google.com/detail/latextocalc/nangjgcfgoikendjhgbcmobbcpijdcjn).
2. Click **Add to Chrome** and follow the prompts to install the extension.
3. Once installed, use the default hotkey `Ctrl+Shift+Z` to translate LaTeX equations from the clipboard into a calculator-friendly format.

For customization of keybindings, visit `chrome://extensions/shortcuts`.

## Installation (Source code)

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable "Developer mode" in the top-right corner.
4. Click "Load unpacked" and select the `LatexToCalc` folder.
