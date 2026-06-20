import { useState, useRef, useEffect } from 'react';
import { Form, ListGroup, Badge } from 'react-bootstrap';
import { X, AtSign } from 'lucide-react';
import './MentionInput.css';

export default function MentionInput({
  value,
  onChange,
  placeholder = "Type message... (@ to mention)",
  teamUsers = [],
  onMentionAdd = () => {},
  onMentionRemove = () => {},
  mentions = [],
  rows = 2,
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const textareaRef = useRef(null);
  const suggestionsRef = useRef(null);

  // Handle text input
  const handleChange = (e) => {
    const text = e.target.value;
    onChange(text);

    // Check for @ mention
    const lastAtIndex = text.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const afterAt = text.substring(lastAtIndex + 1);
      
      // Check if we're still in mention mode (no space after @)
      if (!afterAt.includes(' ')) {
        setMentionQuery(afterAt);
        
        // Filter users
        const filtered = teamUsers.filter(user =>
          user.displayName?.toLowerCase().includes(afterAt.toLowerCase()) ||
          user.email?.toLowerCase().includes(afterAt.toLowerCase())
        );
        
        setFilteredUsers(filtered);
        setShowSuggestions(filtered.length > 0);
      } else {
        setShowSuggestions(false);
        setMentionQuery('');
      }
    } else {
      setShowSuggestions(false);
      setMentionQuery('');
    }
  };

  // Handle user selection from suggestions
  const handleSelectMention = (user) => {
    const text = value;
    const lastAtIndex = text.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      // Replace @query with @username
      const beforeAt = text.substring(0, lastAtIndex);
      const newText = beforeAt + '@' + user.displayName + ' ';
      
      onChange(newText);
      onMentionAdd(user);
      setShowSuggestions(false);
      setMentionQuery('');
      
      // Focus back to textarea
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  };

  // Handle click outside suggestions
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="mention-input-wrapper">
      <div className="mention-mentions-container">
        {mentions && mentions.length > 0 && (
          <div className="mentions-display">
            {mentions.map((mention, idx) => (
              <Badge 
                key={idx}
                bg="info"
                className="mention-badge d-inline-flex align-items-center gap-1"
              >
                <AtSign size={12} />
                {mention.displayName}
                <X
                  size={12}
                  className="cursor-pointer"
                  onClick={() => onMentionRemove(mention)}
                />
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="mention-input-container">
        <Form.Control
          ref={textareaRef}
          as="textarea"
          rows={rows}
          value={value}
          onChange={handleChange}
          onFocus={() => {
            if (mentionQuery && filteredUsers.length > 0) {
              setShowSuggestions(true);
            }
          }}
          placeholder={placeholder}
          className="mention-textarea"
        />

        {/* Suggestions Dropdown */}
        {showSuggestions && filteredUsers.length > 0 && (
          <div ref={suggestionsRef} className="mention-suggestions">
            <ListGroup>
              {filteredUsers.map((user, idx) => (
                <ListGroup.Item
                  key={idx}
                  action
                  onClick={() => handleSelectMention(user)}
                  className="mention-suggestion-item"
                >
                  <div className="d-flex align-items-center gap-2">
                    <div className="mention-user-avatar">
                      {user.displayName?.charAt(0).toUpperCase()}
                    </div>
                    <div className="mention-user-info">
                      <div className="mention-user-name">
                        {user.displayName}
                      </div>
                      <small className="mention-user-email">
                        {user.email}
                      </small>
                    </div>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </div>
        )}
      </div>
    </div>
  );
}
