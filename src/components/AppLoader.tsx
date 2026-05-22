import "./AppLoader.css";

interface AppLoaderProps {
  label?: string;
  words?: string[];
  variant?: "screen" | "inline";
}

const DEFAULT_WORDS = ["打开编辑器", "恢复会话", "准备工作区", "加载文档", "打开编辑器"];

function normalizeWords(words: string[] | undefined): string[] {
  const list = words?.length ? words : DEFAULT_WORDS;
  if (list.length >= 5) return list;
  return Array.from({ length: 5 }, (_, index) => list[index % list.length]);
}

export default function AppLoader({
  label = "正在打开编辑器…",
  words,
  variant = "screen",
}: AppLoaderProps) {
  const displayWords = normalizeWords(words);
  return (
    <div
      className={`app-loader-screen app-loader-screen--${variant}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="app-loader-word-card">
        <div className="app-loader-word-row" aria-hidden="true">
          <p>loading</p>
          <div className="app-loader-words">
            {displayWords.map((word, index) => (
              <span className="app-loader-word" key={`${word}-${index}`}>
                {word}
              </span>
            ))}
          </div>
        </div>
      </div>
      <span className="app-loader-sr-text">{label}</span>
    </div>
  );
}
