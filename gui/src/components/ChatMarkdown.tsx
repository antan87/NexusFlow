import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const remarkPlugins = [remarkGfm];

interface ChatMarkdownProps {
  content: string;
}

export const ChatMarkdown: React.FC<ChatMarkdownProps> = ({ content }) => {
  return (
    <div className="prose prose-sm max-w-none text-foreground prose-a:text-primary prose-code:text-foreground prose-headings:text-foreground prose-pre:border prose-pre:border-border prose-pre:bg-muted/50 prose-strong:text-foreground prose-li:marker:text-muted-foreground">
      <ReactMarkdown remarkPlugins={remarkPlugins}>
        {content}
      </ReactMarkdown>
    </div>
  );
};
