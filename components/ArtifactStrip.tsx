"use client";

export interface Artifact {
    path: string;
    name: string;
}

interface Props {
    artifacts: Artifact[];
    /** 传入整批产物,让 diff 弹窗能以多 tab 加载全部产物并切换 */
    onOpenDiff: (path: string, name: string, artifacts: Artifact[]) => void;
}

/**
 * A slim horizontal strip showing the files written by the current turn.
 * Renders nothing when there are no artifacts. Clicking an artifact opens a
 * git-style diff overlay (HEAD vs 当前改动) instead of the raw file.
 */
export function ArtifactStrip({artifacts, onOpenDiff}: Props) {
    if (artifacts.length === 0) return null;
    return (
        <div className="mb-4 mt-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12px] font-medium text-text-muted">
                产物 / Artifacts
            </span>
            {artifacts.map((artifact) => (
                <button
                    key={artifact.path}
                    type="button"
                    onClick={() => onOpenDiff(artifact.path, artifact.name, artifacts)}
                    className="rounded border border-color-border bg-color-bg-subtle px-2 py-0.5 text-[12px] text-text-muted transition-colors hover:border-color-accent hover:text-color-accent"
                    title={artifact.path}
                >
                    {artifact.name}
                </button>
            ))}
        </div>
    );
}