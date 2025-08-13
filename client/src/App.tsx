import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

const App = () => {
  const [message, setMessage] = useState('');
  const [chatLog, setChatLog] = useState<{ sender: 'user' | 'bot'; text: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!message.trim()) return;

    const userMsg = message.trim();
    setChatLog([...chatLog, { sender: 'user', text: userMsg }]);
    setMessage('');
    setLoading(true);

    try {
      const res = await axios.post('http://localhost:3001/chat', {
        userMessage: userMsg,
      });

      setChatLog((prev) => [...prev, { sender: 'bot', text: res.data.reply }]);
    } catch (error) {
      setChatLog((prev) => [...prev, { sender: 'bot', text: '⚠️ Error talking to the assistant.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <div className="app">
      <h1 className="title">My Avatar (Kaiwei)</h1>

      <div className="chat-window">
        {chatLog.map((entry, i) => (
          <div key={i} className={`message ${entry.sender}`}>
            {entry.text}
          </div>
        ))}
        {loading && (
          <div className="message bot">
            <span className="spinner"></span> Thinking...
          </div>
        )}
      </div>

      <div className="input-container">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Ask me about my experience..."
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading}>➤</button>
      </div>
    </div>
  );
};

export default App;
