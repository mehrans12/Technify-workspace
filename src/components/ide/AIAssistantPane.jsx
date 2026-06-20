import { useState, useEffect, useRef } from 'react';
import { BotMessageSquare, Send, Sparkles, Loader } from 'lucide-react';
import { Button, Form } from 'react-bootstrap';
import { useTheme } from '../../contexts/ThemeContext';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css'; // sleek theme matching our dark mode

const markedInstance = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  })
);

const API_BASE = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

function MarkdownRenderer({ content, editorRef }) {
  const containerRef = useRef(null);
  const html = markedInstance.parse(content || '');

  useEffect(() => {
    if (!containerRef.current) return;
    const preElements = containerRef.current.querySelectorAll('pre');
    preElements.forEach((pre) => {
      // Avoid duplicate action buttons
      if (pre.querySelector('.code-block-actions')) return;

      // Make parent pre relative so absolute button positions properly
      pre.style.position = 'relative';

      // Create action buttons container
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'code-block-actions';

      // Create Copy Button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-block-btn';
      copyBtn.innerHTML = 'Copy';
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const codeElement = pre.querySelector('code');
        const textToCopy = codeElement ? codeElement.innerText : pre.innerText;
        navigator.clipboard.writeText(textToCopy).then(() => {
          copyBtn.innerHTML = 'Copied!';
          setTimeout(() => {
            copyBtn.innerHTML = 'Copy';
          }, 2000);
        });
      });

      // Create Insert Button
      const insertBtn = document.createElement('button');
      insertBtn.className = 'code-block-btn';
      insertBtn.innerHTML = 'Insert';
      insertBtn.type = 'button';
      insertBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const codeElement = pre.querySelector('code');
        const textToInsert = codeElement ? codeElement.innerText : pre.innerText;
        const editor = editorRef?.current;
        if (editor) {
          const position = editor.getPosition();
          editor.executeEdits('', [
            {
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column
              },
              text: textToInsert,
              forceMoveMarkers: true
            }
          ]);
          editor.focus();
        } else {
          alert('No editor is currently active to insert code!');
        }
      });

      actionsDiv.appendChild(copyBtn);
      actionsDiv.appendChild(insertBtn);
      pre.appendChild(actionsDiv);
    });
  }, [html, editorRef]);

  return <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function AIAssistantPane({ editorRef, language, roomId }) {
  const { theme } = useTheme();
  
  // Initialize messages from backup or welcome message
  const [messages, setMessages] = useState(() => {
    if (!roomId) {
      return [
        {
          id: 'welcome',
          role: 'assistant',
          text: "AI: Hello! How can I help you code today?",
          timestamp: Date.now()
        }
      ];
    }
    const localKey = `technify_ai_chat_${roomId}`;
    const stored = localStorage.getItem(localKey);
    if (stored) {
      try {
        const loadedMessages = JSON.parse(stored);
        const now = Date.now();
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        
        const validMessages = loadedMessages.filter(msg => {
          return msg.id === 'welcome' || (now - (msg.timestamp || now)) < ONE_DAY_MS;
        });
        
        if (validMessages.length > 0) {
          return validMessages;
        }
      } catch (err) {
        console.error("Error parsing initial AI chat backup:", err);
      }
    }
    return [
      {
        id: 'welcome',
        role: 'assistant',
        text: "AI: Hello! How can I help you code today?",
        timestamp: Date.now()
      }
    ];
  });

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);

  // Sync and clean messages on roomId change
  useEffect(() => {
    if (!roomId) return;
    const localKey = `technify_ai_chat_${roomId}`;
    const stored = localStorage.getItem(localKey);
    if (stored) {
      try {
        const loadedMessages = JSON.parse(stored);
        const now = Date.now();
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        
        const validMessages = loadedMessages.filter(msg => {
          return msg.id === 'welcome' || (now - (msg.timestamp || now)) < ONE_DAY_MS;
        });
        
        if (validMessages.length > 0) {
          setMessages(validMessages);
          return;
        }
      } catch (err) {
        console.error("Error loading AI chat backup on roomId change:", err);
      }
    }
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        text: "AI: Hello! How can I help you code today?",
        timestamp: Date.now()
      }
    ]);
  }, [roomId]);

  // Save chat backup to localStorage (only when loading finished to prevent spamming writes)
  useEffect(() => {
    if (!roomId || messages.length === 0 || isLoading) return;
    // Don't save if there's only the default welcome message
    if (messages.length === 1 && messages[0].id === 'welcome') return;
    
    localStorage.setItem(`technify_ai_chat_${roomId}`, JSON.stringify(messages));
  }, [messages, roomId, isLoading]);

  const handleClearChat = () => {
    if (window.confirm("Are you sure you want to clear this room's AI chat history?")) {
      const defaultMsg = [
        {
          id: 'welcome',
          role: 'assistant',
          text: "AI: Hello! How can I help you code today?",
          timestamp: Date.now()
        }
      ];
      setMessages(defaultMsg);
      if (roomId) {
        localStorage.removeItem(`technify_ai_chat_${roomId}`);
      }
    }
  };

  // Auto-scroll to bottom as text streams or messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    setIsLoading(true);

    // Append user message
    const userMsg = { id: Date.now().toString(), role: 'user', text: userText, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    // Append empty assistant message placeholder for streaming
    const assistantMsgId = (Date.now() + 1).toString();
    const assistantMsg = { id: assistantMsgId, role: 'assistant', text: '', timestamp: Date.now() };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      // Get latest code content from Monaco Editor
      const currentCode = editorRef?.current ? editorRef.current.getValue() : '';

      const response = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: userText,
          code: currentCode,
          language: language || 'javascript'
        })
      });

      if (!response.body) {
        throw new Error('No stream body received from the server');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        let lineEnd;
        while ((lineEnd = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);

          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const data = JSON.parse(dataStr);
              if (data.content) {
                setMessages(prev => 
                  prev.map(msg => 
                    msg.id === assistantMsgId 
                      ? { ...msg, text: msg.text + data.content }
                      : msg
                  )
                );
              } else if (data.error) {
                setMessages(prev => 
                  prev.map(msg => 
                    msg.id === assistantMsgId 
                      ? { ...msg, text: msg.text + `\n\n❌ Error: ${data.error}` }
                      : msg
                  )
                );
              }
            } catch (err) {
              // Partial JSON chunk
            }
          }
        }
      }
    } catch (err) {
      console.error('AI connection failed:', err);
      setMessages(prev => 
        prev.map(msg => 
          msg.id === assistantMsgId 
            ? { ...msg, text: `⚠️ Failed to communicate with AI Assistant: ${err.message}` }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="h-100 d-flex flex-column" style={{ backgroundColor: 'var(--bg-card)' }}>
      {/* Pane Header */}
      <div className="workspace-pane-header px-3">
        <div className="workspace-pane-title">
          <span style={{ fontSize: '18px' }}>🤖</span>
          <span>AI Chatbot Assistant</span>
        </div>
        <Button 
          variant="outline-secondary" 
          size="sm"
          className="py-1 px-2 rounded-2"
          style={{ fontSize: '10px', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
          onClick={handleClearChat}
        >
          Clear Chat
        </Button>
      </div>

      <div 
        ref={chatContainerRef}
        className="flex-grow-1 p-3 overflow-auto d-flex flex-column gap-3 scrollbar-custom"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        {messages.map(msg => (
          <div 
            key={msg.id} 
            className={`chat-bubble ${msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant'}`}
            style={{ 
              backgroundColor: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-secondary)',
              color: msg.role === 'user' ? (theme === 'dark' ? '#000000' : '#ffffff') : 'var(--text-primary)',
              border: msg.role === 'user' ? 'none' : '1px solid var(--border-subtle)',
              borderLeft: msg.role === 'user' ? 'none' : '3px solid var(--accent)',
              fontWeight: msg.role === 'user' ? '600' : 'normal'
            }}
          >
            {msg.role === 'user' ? (
              <div>{msg.text}</div>
            ) : (
              <MarkdownRenderer content={msg.text} editorRef={editorRef} />
            )}
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.text === '' && (
          <div className="chat-bubble chat-bubble-assistant text-muted d-flex align-items-center" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <Loader size={12} className="me-2 spinner-rotate" /> AI is thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-top" style={{ borderColor: 'var(--border-subtle) !important', backgroundColor: 'var(--bg-card)' }}>
        <Form onSubmit={handleSubmit} className="d-flex gap-2">
          <Form.Control
            type="text"
            className="form-control-sm"
            placeholder="Ask AI something..."
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={isLoading}
            required
            autoComplete="off"
          />
          <Button 
            type="submit" 
            disabled={isLoading || !input.trim()}
            className="custom-cyan-button px-3"
          >
            Send
          </Button>
        </Form>
      </div>
    </div>
  );
}
