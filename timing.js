/**
 * Timing and Debug Module for LatexToCalc
 * Handles all performance measurements and debug logging
 */

class TimingTracker {
    constructor() {
        this.requestTimings = new Map();
        this.debugEnabled = true;
        
        // Define metrics configuration once
        this.metrics = [
            ['extract', 'LaTeX extraction', 'keypress', 'latexReceived'],
            ['settings', 'Settings load', 'settingsLoadStart', 'settingsLoadEnd'],
            ['json', 'JSON serialize', 'jsonSerializeStart', 'jsonSerializeEnd'],
            ['network', 'Network request', 'networkStart', 'networkEnd'],
            ['parse', 'Response parsing', 'parseStart', 'parseEnd'],
            ['tabQuery', 'Tab query', 'tabQueryStart', 'tabQueryEnd'],
            ['prep', 'Clipboard prep', 'clipboardPrepStart', 'clipboardPrepEnd'],
            ['write', 'Clipboard write', 'clipboardWriteStart', 'clipboardWritten']
        ];
        
        // Create timing point names from metrics
        this.timingPoints = new Set(['keypress']);
        this.metrics.forEach(([, , start, end]) => {
            this.timingPoints.add(start);
            this.timingPoints.add(end);
        });
    }

    startRequest(requestId) {
        // Initialize all timing points to 0
        const timing = {};
        this.timingPoints.forEach(point => timing[point] = 0);
        timing.keypress = performance.now();
        this.requestTimings.set(requestId, timing);
        return timing;
    }

    getTiming(requestId) {
        return this.requestTimings.get(requestId) || this.startRequest(requestId);
    }

    mark(requestId, pointName) {
        this.getTiming(requestId)[pointName] = performance.now();
    }

    round(value) {
        return Math.round(value * 10) / 10;
    }

    generateBreakdown(requestId) {
        const timing = this.getTiming(requestId);
        
        if (!timing.clipboardWritten) return null;
        
        const total = this.round(timing.clipboardWritten - timing.keypress);
        if (total <= 0) return null;

        // Build message and calculate metrics in one pass
        const lines = [`⏱ Timing breakdown (total: ${total.toFixed(1)} ms):`];
        const styles = [];
        
        this.metrics.forEach(([key, label, start, end]) => {
            const duration = this.round(timing[end] - timing[start]);
            const percent = this.round((duration / total) * 100);
            const hue = Math.max(0, 120 - (percent * 1.2));
            
            lines.push(`    - ${label.padEnd(18)} %c${duration.toFixed(1).padStart(5)} ms%c (${percent.toFixed(1).padStart(4)}%)`);
            styles.push(`color: hsl(${hue}, 80%, 45%)`, 'color: inherit');
        });

        return {
            message: lines.join('\n'),
            styles,
            total: this.round(total)
        };
    }

    logBreakdown(requestId, logFunction) {
        if (!this.debugEnabled) return;
        
        const breakdown = this.generateBreakdown(requestId);
        if (!breakdown) {
            logFunction('Timing breakdown incomplete', 'verbose');
            return;
        }

        // Log to console
        console.debug(
            `%c LatexToCalc [BG] › %c${breakdown.message}`,
            'color:#2196F3;font-weight:bold', '',
            ...breakdown.styles
        );

        // Send to content script
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'LOG_MESSAGE',
                    logType: 'verbose',
                    message: breakdown.message,
                    consoleArgs: breakdown.styles
                });
                
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'TRANSLATION_COMPLETED',
                    totalTime: breakdown.total
                });
            }
        });

        // Cleanup
        this.requestTimings.delete(requestId);
        if (this.requestTimings.size > 10) {
            const [oldestId] = this.requestTimings.keys();
            this.requestTimings.delete(oldestId);
        }
    }
}

// Create global instance for Chrome extension
const timingTracker = new TimingTracker();
