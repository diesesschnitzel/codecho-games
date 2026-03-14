DROP TABLE IF EXISTS scores;
CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    game TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_scores_game_created ON scores(game, created_at);
CREATE INDEX IF NOT EXISTS idx_scores_game_score ON scores(game, score DESC);
