import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice input and output using the browser's own speech APIs.
 *
 * Browser-native rather than OpenAI's audio endpoints: free, no server
 * round-trip, no key handling. Everything is contained here, so swapping in
 * gpt-4o-transcribe / gpt-4o-mini-tts later is a one-file change.
 *
 * Support in 2026: Chrome, Edge and Safari, still behind the
 * `webkitSpeechRecognition` prefix. Firefox keeps it behind a flag, so the UI
 * hides rather than breaks. Both APIs need HTTPS or localhost.
 *
 * PRIVACY: by default Chrome streams audio to Google's servers for
 * recognition. Chrome 139 added an on-device mode, which this requests
 * whenever it is available — audience questions should not leave the machine
 * if they do not have to. `onDevice` reports which mode is actually in use so
 * the UI can say so honestly.
 */

interface SpeechRecognitionAlternative {
    transcript: string;
}
interface SpeechRecognitionResult {
    isFinal: boolean;
    0: SpeechRecognitionAlternative;
}
interface SpeechRecognitionEventLike {
    resultIndex: number;
    results: { length: number; [index: number]: SpeechRecognitionResult };
}
interface SpeechRecognitionLike {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    processLocally?: boolean;
    start(): void;
    stop(): void;
    abort?(): void;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
}

type RecognitionConstructor = (new () => SpeechRecognitionLike) & {
    available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
};

function getRecognition(): RecognitionConstructor | undefined {
    const w = window as unknown as {
        SpeechRecognition?: RecognitionConstructor;
        webkitSpeechRecognition?: RecognitionConstructor;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const speechInputSupported = Boolean(
    typeof window !== 'undefined' && getRecognition(),
);
export const speechOutputSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Silence after which a question is considered finished and sent. */
const DEFAULT_SILENCE_MS = 1500;

/**
 * Voice used for spoken answers, matched as a substring of the installed name.
 *
 * The browser default is usually female and varies by machine, which is a poor
 * fit for an avatar speaking as its owner. Overridable without a code change,
 * since the good voices differ between operating systems.
 */
const PREFERRED_VOICE = import.meta.env.VITE_SPEECH_VOICE || 'Microsoft Mark';

/**
 * Where the voice has reached in the text it is reading.
 *
 * `synced` says whether real boundary events are arriving. They do for local
 * voices and usually do not for network ones, so the UI must be able to tell
 * "word three" from "no idea" rather than showing a highlight stuck at the
 * first word for the whole answer.
 */
export interface SpeechProgress {
    id: string | null;
    text: string;
    charIndex: number;
    wordCount: number;
    synced: boolean;
}

const EMPTY_PROGRESS: SpeechProgress = {
    id: null,
    text: '',
    charIndex: 0,
    wordCount: 0,
    synced: false,
};

interface UseSpeechInputOptions {
    /** Fired once the speaker has paused long enough to look finished. */
    onUtterance: (text: string) => void;
    /**
     * Pauses listening without switching the mic off — used while the avatar is
     * speaking, otherwise its own voice is transcribed and asked straight back
     * as the next question.
     */
    suspended?: boolean;
    silenceMs?: number;
}

export function useSpeechInput({
    onUtterance,
    suspended = false,
    silenceMs = DEFAULT_SILENCE_MS,
}: UseSpeechInputOptions) {
    const [micOn, setMicOn] = useState(false);
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [onDevice, setOnDevice] = useState(false);

    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const bufferRef = useRef('');
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const onUtteranceRef = useRef(onUtterance);
    onUtteranceRef.current = onUtterance;

    const clearTimer = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
    };

    /** Emits whatever has been heard, if anything. */
    const flush = useCallback(() => {
        clearTimer();
        const text = bufferRef.current.trim();
        bufferRef.current = '';
        setInterim('');
        if (text) onUtteranceRef.current(text);
    }, []);

    const stopRecognition = useCallback(() => {
        clearTimer();
        const recognition = recognitionRef.current;
        recognitionRef.current = null;
        if (recognition) {
            recognition.onend = null;
            recognition.onresult = null;
            recognition.onerror = null;
            try {
                recognition.abort?.() ?? recognition.stop();
            } catch {
                // Already stopped.
            }
        }
        setListening(false);
        setInterim('');
    }, []);

    const startRecognition = useCallback(async () => {
        const Recognition = getRecognition();
        if (!Recognition || recognitionRef.current) return;

        const lang = navigator.language || 'en-US';

        // Prefer on-device recognition where the browser offers it, so audio
        // never leaves the machine.
        let local = false;
        try {
            if (typeof Recognition.available === 'function') {
                const status = await Recognition.available({
                    langs: [lang],
                    processLocally: true,
                });
                local = status === 'available';
            }
        } catch {
            // Older browsers have no availability check; fall back to cloud.
        }
        setOnDevice(local);

        const recognition = new Recognition();
        recognitionRef.current = recognition;

        if (local) recognition.processLocally = true;
        // Continuous, because an audience question runs to several sentences
        // with pauses in the middle. The silence timer decides when it ended.
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = lang;

        recognition.onresult = event => {
            let pending = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i]!;
                if (result.isFinal) bufferRef.current += `${result[0].transcript} `;
                else pending += result[0].transcript;
            }
            setInterim(pending);

            // Any speech at all restarts the countdown, so thinking pauses do
            // not cut a question in half.
            clearTimer();
            if (bufferRef.current.trim()) {
                timerRef.current = setTimeout(flush, silenceMs);
            }
        };

        recognition.onerror = event => {
            // Normal when stopping, or during a natural pause.
            if (event.error === 'aborted' || event.error === 'no-speech') return;
            setError(
                event.error === 'not-allowed'
                    ? 'Microphone access was denied. Allow it in the address bar, then try again.'
                    : `Speech input failed: ${event.error}`,
            );
            setMicOn(false);
        };

        // Chrome ends the session on its own after a long silence. Restart so
        // hands-free stays hands-free.
        recognition.onend = () => {
            setListening(false);
            if (recognitionRef.current === recognition) {
                recognitionRef.current = null;
                setMicOn(current => current);
            }
        };

        try {
            recognition.start();
            setListening(true);
            setError(null);
        } catch {
            recognitionRef.current = null;
        }
    }, [flush, silenceMs]);

    // Single place that reconciles intent (micOn, suspended) with reality.
    useEffect(() => {
        if (micOn && !suspended) {
            void startRecognition();
        } else {
            // Suspending mid-sentence should not lose what was already heard.
            if (suspended) flush();
            stopRecognition();
        }
    }, [micOn, suspended, listening, startRecognition, stopRecognition, flush]);

    useEffect(() => () => stopRecognition(), [stopRecognition]);

    return {
        supported: speechInputSupported,
        micOn,
        listening,
        interim,
        error,
        onDevice,
        toggle: () => setMicOn(current => !current),
        stop: () => setMicOn(false),
    };
}

/**
 * Corrections applied before speaking.
 *
 * Browser speech synthesis has no phoneme control — SSML is not supported — so
 * a mispronounced name can only be fixed by respelling it phonetically. "Ada"
 * comes out as "A. D. A." on some voices because short capitalised words look
 * like initialisms.
 *
 * Configured through VITE_SPEECH_FIXES ("Ada=Ay-duh;NUS=N U S") rather than
 * hardcoded, so personal names stay out of the repository like everything else.
 */
function pronunciationFixes(): [RegExp, string][] {
    const raw = import.meta.env.VITE_SPEECH_FIXES;
    if (!raw) return [];

    return raw
        .split(';')
        .map((pair: string) => pair.split('='))
        .filter((parts: string[]) => parts.length === 2 && parts[0]!.trim())
        .map(([from, to]: string[]) => [
            // Whole words only, so "Ada" does not corrupt "Adapter".
            new RegExp(`\\b${from!.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'),
            to!.trim(),
        ] as [RegExp, string]);
}

function applyPronunciation(text: string): string {
    return pronunciationFixes().reduce(
        (result, [pattern, replacement]) => result.replace(pattern, replacement),
        text,
    );
}

/**
 * Reads answers aloud.
 *
 * Off by default and remembered per browser: decision D1 kept answers on
 * screen, so the presenter opts in rather than having a laptop talk unprompted.
 */
export function useSpeechOutput() {
    // On by default. The stored value is only consulted when it exists, so a
    // deliberate mute is remembered while a first-time visitor gets the voice.
    const [enabled, setEnabled] = useState(() => {
        try {
            const stored = localStorage.getItem('myavatar:speak');
            return stored === null ? true : stored === 'true';
        } catch {
            return true;
        }
    });
    const [speaking, setSpeaking] = useState(false);
    const [progress, setProgress] = useState<SpeechProgress>(EMPTY_PROGRESS);

    const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);

    useEffect(() => {
        if (!speechOutputSupported) return;

        const load = () => {
            const available = window.speechSynthesis.getVoices();
            if (available.length === 0) return;

            // Matched loosely: the installed name carries a locale suffix, as
            // in "Microsoft Mark - English (United States)".
            const wanted = PREFERRED_VOICE.toLowerCase();
            const match = available.find(v => v.name.toLowerCase().includes(wanted));

            // No match is fine — an unfamiliar machine falls back to whatever
            // the browser would have used anyway.
            setVoice(match ?? null);
        };

        load();
        // Chrome populates the list asynchronously, so the first read is often
        // empty and this event is the only reliable signal.
        window.speechSynthesis.addEventListener('voiceschanged', load);
        return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
    }, []);

    const toggle = useCallback(() => {
        setEnabled(previous => {
            const next = !previous;
            try {
                localStorage.setItem('myavatar:speak', String(next));
            } catch {
                // Private browsing blocks storage; the toggle still works now.
            }
            if (!next) {
                window.speechSynthesis?.cancel();
                setSpeaking(false);
                setProgress(EMPTY_PROGRESS);
            }
            return next;
        });
    }, []);

    const speak = useCallback(
        (text: string, id?: string) => {
            if (!enabled || !speechOutputSupported || !text.trim()) return;
            window.speechSynthesis.cancel();

            // Respelling shifts character offsets, so boundary events would
            // point at the wrong place in the original text. Only respell when
            // something actually changes, and drop word-sync when it does —
            // wrong highlighting is worse than none.
            const spoken = applyPronunciation(text);
            const offsetsUsable = spoken === text;

            const utterance = new SpeechSynthesisUtterance(spoken);
            utterance.lang = navigator.language || 'en-US';
            if (voice) utterance.voice = voice;

            setProgress({ id: id ?? null, text, charIndex: 0, wordCount: 0, synced: false });

            // Real speech position, not a guess. Boundary events fire per word
            // for local voices; Google's network voices often send none, hence
            // `synced` — the UI falls back rather than freezing on word one.
            if (offsetsUsable) {
                utterance.onboundary = event => {
                    if (event.name && event.name !== 'word') return;
                    setProgress(current => ({
                        ...current,
                        charIndex: event.charIndex,
                        wordCount: current.wordCount + 1,
                        synced: true,
                    }));
                };
            }

            const finish = () => {
                setSpeaking(false);
                setProgress(EMPTY_PROGRESS);
            };
            utterance.onend = finish;
            utterance.onerror = finish;

            setSpeaking(true);
            window.speechSynthesis.speak(utterance);
        },
        [enabled, voice],
    );

    /**
     * Cuts the current answer off mid-sentence.
     *
     * Distinct from `toggle`, which turns the feature off entirely. Interrupting
     * one wrong answer in front of a room should not silence every answer after
     * it — the presenter would then have to remember to switch it back on.
     */
    const stop = useCallback(() => {
        window.speechSynthesis?.cancel();
        setSpeaking(false);
        setProgress(EMPTY_PROGRESS);
    }, []);

    useEffect(() => () => window.speechSynthesis?.cancel(), []);

    return { enabled, speaking, progress, toggle, speak, stop };
}
