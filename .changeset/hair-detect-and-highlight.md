---
'@dth/ui': patch
'@dth/web': patch
---

Hair picker fixes: a search match no longer tears the option label apart ("Bi … xie Cut Main" — the bold highlight became separate flex items), and hair detection knows the hairstyle vocabulary (Bixie/Pixie Cut, Bob, Shag, Updo, Dreads, …) so items named after their style — never containing the word "hair" — classify as HAIR and get picked by the magic wand and creation pre-select.
