import React, { useState } from 'react';
import axios from 'axios';

const App = () => {
  const [summary, setSummary] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [message, setMessage] = useState('');
  const [chatLog, setChatLog] = useState<string[]>([]);
  const name = "Your Name";

  const handleSend = async () => {
    const res = await axios.post('http://localhost:3001/chat', {
      name,
      summary,
      linkedin,
      userMessage: message,
    });
    setChatLog([...chatLog, `You: ${message}`, `Bot: ${res.data.reply}`]);
    setMessage('');
  };

  return (
    <div>
      <h1>Career Chatbot</h1>
      <textarea placeholder="Enter Summary" onChange={e => setSummary(e.target.value)} />
      <textarea placeholder="Enter LinkedIn Text" onChange={e => setLinkedin(e.target.value)} />
      <div>
        {chatLog.map((line, i) => <p key={i}>{line}</p>)}
      </div>
      <input value={message} onChange={e => setMessage(e.target.value)} />
      <button onClick={handleSend}>Send</button>
    </div>
  );
};

export default App;
