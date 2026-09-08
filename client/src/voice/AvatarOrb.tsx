import { useState } from 'react';
import './orb.css';

/**
 * The avatar's visible presence.
 *
 * Four states, each with its own motion, so a glance across a room tells you
 * what is happening without reading anything:
 *
 *   idle      slow breath                     waiting for you
 *   listening ripples running inward          hearing you
 *   thinking  an arc orbiting the core        working
 *   speaking  rings expanding on each word    talking
 *
 * The speaking state is driven by real word-boundary events, not a loop.
 * Browser speech synthesis plays straight to the output device and cannot be
 * routed into Web Audio, so a "reactive" waveform would be an animation
 * pretending to hear something. Pulsing on words actually spoken is the only
 * honest signal available — and it reads better, because the rhythm is real.
 *
 * ARTWORK: drop a square image at `client/public/orb.png` and it becomes the
 * core, with the rings and pulses animating around it. It is composited with
 * `mix-blend-mode: screen`, so a pure black background disappears and only the
 * glow remains — which is how to get transparency out of image models that do
 * not reliably produce an alpha channel. Without the file, the CSS core below
 * is used instead, so this never renders broken.
 */
export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

const ARTWORK = '/orb.png';

interface AvatarOrbProps {
    state: OrbState;
    /** Increments once per spoken word; drives the pulse when speaking. */
    wordCount?: number;
    /** False when no boundary events arrive — falls back to a steady rhythm. */
    synced?: boolean;
    size?: number;
}

const AvatarOrb = ({
    state,
    wordCount = 0,
    synced = false,
    size = 132,
}: AvatarOrbProps) => {
    const [hasArtwork, setHasArtwork] = useState(true);
    const wordSynced = state === 'speaking' && synced;

    return (
        <div
            className={[
                'avatar-orb',
                `state-${state}`,
                wordSynced ? 'word-synced' : '',
                hasArtwork ? 'has-art' : '',
            ].filter(Boolean).join(' ')}
            style={{ width: size, height: size }}
            role="img"
            aria-label={
                {
                    idle: 'Idle',
                    listening: 'Listening',
                    thinking: 'Thinking',
                    speaking: 'Speaking',
                }[state]
            }
        >
            {/* Re-keying on each word restarts the CSS animation, so the pulse
                lands on the word instead of free-running past it. */}
            <span className="ring outer" key={wordSynced ? `o${wordCount}` : 'o'} />
            <span className="ring middle" key={wordSynced ? `m${wordCount}` : 'm'} />
            <span className="halo" />

            {hasArtwork ? (
                <img
                    className="art"
                    src={ARTWORK}
                    alt=""
                    aria-hidden="true"
                    onError={() => setHasArtwork(false)}
                />
            ) : (
                <span className="core" />
            )}

            {state === 'thinking' && <span className="arc" />}
        </div>
    );
};

export default AvatarOrb;
