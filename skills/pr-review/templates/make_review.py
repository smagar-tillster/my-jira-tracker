"""Builds the JSON for `gh api repos/<owner>/<repo>/pulls/<n>/reviews --method POST --input review_<n>.json`.

Copy this file to the scratchpad, fill in the values below, run it with python3. It writes review_<PR_NUMBER>.json next to the
script. Writing the text in Python strings avoids hand-escaped JSON. The review is a COMMENT review (never an approval or a
change request) pinned to the head commit that was read.
"""
import json
import pathlib

PR_NUMBER = 0                      # the PR number
COMMIT_ID = "<headRefOid from gh pr view>"
MAIN = "path/to/File.java"         # shortcut for paths used several times

BODY = """### Summary
...

**Result:** 0 issues, 0 suggestions, 0 questions, 0 nits.

### Impact
- ...

### Testing
- ...

_Reviewed from the diff and <files read>; <what was not read or run>._"""

# One dict per line comment. Single line: path, line, side, body. Range: also start_line (same hunk, same side, before line).
# side is "RIGHT" (new file) or "LEFT" (deleted line). Start the body with **Issue:**, **Suggestion:**, **Question:** or **Nit:**.
# A ```suggestion block replaces exactly the anchored lines, with the same indentation, on RIGHT side lines only.
COMMENTS = [
    # {"path": MAIN, "line": 10, "side": "RIGHT", "body": "**Suggestion:** ...\n\n```suggestion\n    fixed line\n```"},
    # {"path": MAIN, "start_line": 20, "line": 22, "side": "RIGHT", "body": "**Nit:** ..."},
]


def check(comments):
    for i, c in enumerate(comments):
        tag = f"comment {i} ({c.get('path')}:{c.get('line')})"
        assert c.get("path") and isinstance(c.get("line"), int) and c["line"] > 0, f"{tag}: needs a path and a positive line"
        assert c.get("side") in ("LEFT", "RIGHT"), f"{tag}: side must be LEFT or RIGHT"
        assert str(c.get("body", "")).strip(), f"{tag}: empty body"
        if "start_line" in c:
            assert isinstance(c["start_line"], int) and 0 < c["start_line"] < c["line"], f"{tag}: start_line must be before line"
            c["start_side"] = c["side"]
        if "```suggestion" in c["body"]:
            assert c["side"] == "RIGHT", f"{tag}: suggestion blocks only on RIGHT side lines"


check(COMMENTS)
review = {"commit_id": COMMIT_ID, "event": "COMMENT", "body": BODY, "comments": COMMENTS}
out = pathlib.Path(__file__).with_name(f"review_{PR_NUMBER}.json")
out.write_text(json.dumps(review, indent=2))
print(out, len(COMMENTS), "comments")
