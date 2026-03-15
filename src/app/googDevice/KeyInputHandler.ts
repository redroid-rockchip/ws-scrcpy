import { KeyCodeControlMessage } from '../controlMessage/KeyCodeControlMessage';
import KeyEvent from './android/KeyEvent';
import { KeyToCodeMap } from './KeyToCodeMap';

export interface KeyEventListener {
    onKeyEvent: (event: KeyCodeControlMessage) => void;
}

export class KeyInputHandler {
    private static readonly repeatCounter: Map<number, number> = new Map();
    private static readonly listeners: Set<KeyEventListener> = new Set();
    private static mobileInput: HTMLInputElement | null = null;
    private static mobileInputBlurHandler: (() => void) | null = null;
    private static readonly isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    private static handler = (event: Event): void => {
        const keyboardEvent = event as KeyboardEvent;
        const keyCode = KeyToCodeMap.get(keyboardEvent.code);
        if (!keyCode) {
            return;
        }
        let action: typeof KeyEvent.ACTION_DOWN | typeof KeyEvent.ACTION_DOWN;
        let repeatCount = 0;
        if (keyboardEvent.type === 'keydown') {
            action = KeyEvent.ACTION_DOWN;
            if (keyboardEvent.repeat) {
                let count = KeyInputHandler.repeatCounter.get(keyCode);
                if (typeof count !== 'number') {
                    count = 1;
                } else {
                    count++;
                }
                repeatCount = count;
                KeyInputHandler.repeatCounter.set(keyCode, count);
            }
        } else if (keyboardEvent.type === 'keyup') {
            action = KeyEvent.ACTION_UP;
            KeyInputHandler.repeatCounter.delete(keyCode);
        } else {
            return;
        }
        const metaState =
            (keyboardEvent.getModifierState('Alt') ? KeyEvent.META_ALT_ON : 0) |
            (keyboardEvent.getModifierState('Shift') ? KeyEvent.META_SHIFT_ON : 0) |
            (keyboardEvent.getModifierState('Control') ? KeyEvent.META_CTRL_ON : 0) |
            (keyboardEvent.getModifierState('Meta') ? KeyEvent.META_META_ON : 0) |
            (keyboardEvent.getModifierState('CapsLock') ? KeyEvent.META_CAPS_LOCK_ON : 0) |
            (keyboardEvent.getModifierState('ScrollLock') ? KeyEvent.META_SCROLL_LOCK_ON : 0) |
            (keyboardEvent.getModifierState('NumLock') ? KeyEvent.META_NUM_LOCK_ON : 0);

        const controlMessage: KeyCodeControlMessage = new KeyCodeControlMessage(
            action,
            keyCode,
            repeatCount,
            metaState,
        );
        KeyInputHandler.listeners.forEach((listener) => {
            listener.onKeyEvent(controlMessage);
        });
        event.preventDefault();
    };
    private static attachListeners(): void {
        document.body.addEventListener('keydown', this.handler);
        document.body.addEventListener('keyup', this.handler);
        if (this.isTouchDevice) {
            const input = document.createElement('input');
            input.type = 'text';
            input.autocomplete = 'off';
            Object.assign(input.style, {
                position: 'fixed',
                opacity: '0',
                width: '1px',
                height: '1px',
                top: '0',
                left: '0',
                border: 'none',
                outline: 'none',
                zIndex: '-1',
                pointerEvents: 'none',
            });
            document.body.appendChild(input);
            this.mobileInput = input;
            const blurHandler = () => {
                // Re-focus after a short delay so touch interactions on the canvas don't close the keyboard
                setTimeout(() => {
                    if (this.mobileInput) {
                        this.mobileInput.focus();
                    }
                }, 100);
            };
            input.addEventListener('blur', blurHandler);
            this.mobileInputBlurHandler = blurHandler;
            input.focus();
        }
    }
    private static detachListeners(): void {
        document.body.removeEventListener('keydown', this.handler);
        document.body.removeEventListener('keyup', this.handler);
        if (this.mobileInput) {
            if (this.mobileInputBlurHandler) {
                this.mobileInput.removeEventListener('blur', this.mobileInputBlurHandler);
                this.mobileInputBlurHandler = null;
            }
            this.mobileInput.blur();
            this.mobileInput.remove();
            this.mobileInput = null;
        }
    }
    public static addEventListener(listener: KeyEventListener): void {
        if (!this.listeners.size) {
            this.attachListeners();
        }
        this.listeners.add(listener);
    }
    public static removeEventListener(listener: KeyEventListener): void {
        this.listeners.delete(listener);
        if (!this.listeners.size) {
            this.detachListeners();
        }
    }
}
