import { Button, Tooltip } from 'antd';
import { SoundOutlined, PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';
import useSpeech from '../hooks/useSpeech';
import useIsMobile from '../hooks/useIsMobile';

/** Strip markdown syntax to produce plain text for speech */
function stripMarkdown(md: string): string {
  return md
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`[^`]*`/g, '')
    // Remove images
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Convert links to just their text
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
    // Remove headings markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    // Remove strikethrough
    .replace(/~~([^~]+)~~/g, '$1')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove blockquote markers
    .replace(/^>\s?/gm, '')
    // Remove list markers
    .replace(/^[\s]*[-+*]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove table separators
    .replace(/^\|?[-:|]+\|?$/gm, '')
    // Remove table pipes
    .replace(/\|/g, '，')
    // Collapse multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface SpeechButtonProps {
  /** Function that returns the text to speak (called on click) */
  getText: () => string;
  /** Whether to strip markdown before speaking (default: true) */
  markdown?: boolean;
  /** Disable the button */
  disabled?: boolean;
}

export default function SpeechButton({ getText, markdown = true, disabled = false }: SpeechButtonProps) {
  const { isSupported, speaking, paused, speak, pause, resume, stop } = useSpeech();
  const isMobile = useIsMobile();

  if (!isSupported) return null;

  const handleClick = () => {
    if (speaking && !paused) {
      // Currently speaking -> pause
      pause();
    } else if (paused) {
      // Paused -> resume
      resume();
    } else {
      // Not speaking -> start
      const raw = getText();
      const text = markdown ? stripMarkdown(raw) : raw;
      speak(text);
    }
  };

  const icon = speaking && !paused
    ? <PauseCircleOutlined />
    : paused
      ? <PlayCircleOutlined />
      : <SoundOutlined />;

  const label = speaking && !paused
    ? '暂停'
    : paused
      ? '继续'
      : '播报';

  const btn = (
    <Button
      size="small"
      icon={icon}
      onClick={handleClick}
      disabled={disabled}
      onDoubleClick={speaking ? stop : undefined}
      type={speaking ? 'primary' : 'default'}
      ghost={speaking}
    >
      {!isMobile && label}
    </Button>
  );

  return isMobile ? (
    <Tooltip title={`${label}（双击停止）`}>{btn}</Tooltip>
  ) : (
    <Tooltip title="双击停止播报">{btn}</Tooltip>
  );
}

export { stripMarkdown };
