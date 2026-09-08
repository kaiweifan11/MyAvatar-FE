import type { SpeechProgress } from './useVoice';
import './spoken.css';

/**
 * An answer, with the words already spoken dimmed and the current word lit.
 *
 * The point is the projector: a room reading a wall of text has no idea where
 * the voice has got to. Following along is easy when the current word is
 * marked, and anyone who missed something can see how far back it was.
 *
 * Uses real boundary events, so the highlight tracks the actual voice rather
 * than a timer guessing at reading speed. When those are unavailable the text
 * renders plainly — a highlight stuck on word one would be worse than none.
 */
interface SpokenTextProps {
    text: string;
    id: string;
    progress: SpeechProgress;
}

const SpokenText = ({ text, id, progress }: SpokenTextProps) => {
    const active = progress.synced && progress.id === id && progress.text === text;

    if (!active) return <>{text}</>;

    // charIndex is the offset of the word being spoken, so everything before it
    // is done and the rest is still to come.
    const spoken = text.slice(0, progress.charIndex);
    const remainder = text.slice(progress.charIndex);
    const boundary = remainder.search(/\s/);
    const current = boundary === -1 ? remainder : remainder.slice(0, boundary);
    const upcoming = boundary === -1 ? '' : remainder.slice(boundary);

    return (
        <>
            <span className="spoken-done">{spoken}</span>
            <span className="spoken-now">{current}</span>
            <span className="spoken-todo">{upcoming}</span>
        </>
    );
};

export default SpokenText;
