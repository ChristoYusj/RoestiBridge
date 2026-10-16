import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from roestibridge import metrics, rsd  # noqa: E402

EXT = Path(__file__).resolve().parents[1] / "src" / "extension"


class TestProjection(unittest.TestCase):
    def test_exact_span_marks_its_tokens(self):
        toks = "Over 70 per cent of Switzerland ' s energy".split()
        out = rsd.project([{"a": "70 per cent", "severity": 4, "type": "number"}], toks, "a")
        self.assertEqual(out[:4], [0.0, 0.8, 0.8, 0.8])
        self.assertTrue(all(v == 0.0 for v in out[4:]))

    def test_apostrophes_and_garbled_chars_still_match(self):
        toks = "L�approvisionnement de la Suisse".split()
        out = rsd.project([{"a": "L�approvisionnement", "severity": 5, "type": "nuance"}], toks, "a")
        self.assertEqual(out[0], 1.0)

    def test_severity_one_is_dropped_and_omissions_are_full(self):
        toks = "a b c d e f".split()
        diffs = [{"a": "a b", "severity": 1, "type": "nuance"}, {"a": "e f", "severity": 2, "type": "omission"}]
        self.assertEqual(rsd.project(diffs, toks, "a"), [0, 0, 0, 0, 1.0, 1.0])

    def test_missing_span_side_is_ignored(self):
        self.assertEqual(rsd.project([{"a": "", "b": "x", "severity": 5}], ["x"], "a"), [0.0])

    def test_number_prior(self):
        self.assertEqual(rsd.number_prior(["in", "2023", "and", "70"], "en 2024 et 70"), [0, 0.5, 0, 0])


class TestParsing(unittest.TestCase):
    def test_fenced_and_bare_list(self):
        self.assertEqual(len(rsd.parse_differences('```json\n{"differences": [{"a": "x"}]}\n```')), 1)
        self.assertEqual(len(rsd.parse_differences('[{"a": "x"}, {"a": "y"}]')), 2)
        self.assertEqual(rsd.parse_differences("no json here"), [])

    def test_prompt_shared_with_extension(self):
        prompt = json.loads((EXT / "shared" / "prompt.json").read_text(encoding="utf-8"))
        self.assertEqual(prompt, rsd.PROMPT)
        msgs = rsd.build_messages("A text", "B text", "en", "fr")
        self.assertIn("TEXT A (English)", msgs[1]["content"])
        self.assertIn("TEXT B (French)", msgs[1]["content"])
        self.assertNotIn("{", msgs[1]["content"].split("Return JSON")[0].replace("{lang", ""))


class TestMetric(unittest.TestCase):
    def test_spearman_known_values(self):
        self.assertAlmostEqual(metrics.spearman([1, 2, 3, 4], [1, 2, 3, 4]), 1.0)
        self.assertAlmostEqual(metrics.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)
        # ties use average ranks (same as scipy / nlpstats)
        self.assertAlmostEqual(metrics.spearman([0, 0, 1, 1], [0, 1, 0, 1]), 0.0)

    def test_pooling_drops_gold_minus_one_and_pads(self):
        gold = [{"id": "x", "labels_a": [0.0, -1, 1.0], "labels_b": [-1, -1]}]
        preds = {"x": {"labels_a": [0.1], "labels_b": []}}
        P, G = metrics.pooled(preds, gold)
        self.assertEqual(G, [0.0, 1.0])       # -1 removed, all -1 side B skipped
        self.assertEqual(P, [0.1, 0.0])       # prediction padded with 0.0


class TestExtensionFiles(unittest.TestCase):
    def test_manifest_references_existing_files(self):
        m = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
        files = list(m["background"]["scripts"])
        for cs in m["content_scripts"]:
            files += cs["js"] + cs.get("css", [])
        files.append(m["options_ui"]["page"])
        for f in files:
            self.assertTrue((EXT / f).exists(), f)

    def test_every_sent_message_has_a_background_handler(self):
        import re
        bg = (EXT / "background.js").read_text(encoding="utf-8")
        handlers = set(re.findall(r"^\s{4}(\w+): \(\) =>|^\s{4}(\w+): async", bg, re.M))
        handlers = {a or b for a, b in handlers}
        senders = list((EXT / "content").glob("*.js")) + [EXT / "pdf" / "viewer.js", EXT / "options" / "options.js"]
        sent = set()
        for p in senders:
            sent |= set(re.findall(r'sendMessage\(\{\s*type: "(\w+)"', p.read_text(encoding="utf-8")))
        self.assertTrue(sent, "no messages found")
        self.assertEqual(sent - handlers, set())

    def test_no_control_characters_in_sources(self):
        # guards against heredoc accidents turning "\b" into a backspace character
        for p in list(EXT.rglob("*.js")) + list((EXT.parent / "roestibridge").rglob("*.py")):
            if "lib" in p.parts:
                continue
            self.assertNotIn("\x08", p.read_text(encoding="utf-8"), str(p))


if __name__ == "__main__":
    unittest.main()
