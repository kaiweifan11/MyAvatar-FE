import { useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { MAX_MESSAGE_LENGTH } from '@myavatar/shared';
import './App.css';

const apiUrl = import.meta.env.VITE_BE_URL;

const App = () => {
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const { messages, sendMessage, status, error } = useChat({
        transport: new DefaultChatTransport({ api: `${apiUrl}/chat` }),
    });

    // `submitted` covers the gap before the first token arrives, which is where
    // the cold start on the free tier is felt.
    const busy = status === 'submitted' || status === 'streaming';

    const handleSend = () => {
        const text = input.trim();
        if (!text || busy) return;

        sendMessage({ text });
        setInput('');
        inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="app">
            <h1 className="title">My Avatar (Kaiwei)</h1>
            <p className="caption">
                An AI-powered digital twin of myself - connected to a LLM and built to answer
                anything about my background, work, and journey. Welcome to My Avatar.
            </p>

            <div className="chat-window">
                {messages.map(message => {
                    const text = message.parts
                        .filter(part => part.type === 'text')
                        .map(part => part.text)
                        .join('');

                    if (!text) return null;

                    return (
                        <div
                            key={message.id}
                            className={`message ${message.role === 'user' ? 'user' : 'bot'}`}
                        >
                            {text}
                        </div>
                    );
                })}

                {status === 'submitted' && (
                    <div className="message bot">
                        <span className="spinner"></span> Thinking...
                    </div>
                )}

                {error && (
                    <div className="message bot">
                        Something went wrong talking to the assistant. Try again in a moment.
                    </div>
                )}
            </div>

            <div className="input-container">
                <input
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask me about my experience..."
                    disabled={busy}
                />
                <button onClick={handleSend} disabled={busy || !input.trim()}>
                    &#10148;
                </button>
            </div>
        </div>
    );
};

export default App;
