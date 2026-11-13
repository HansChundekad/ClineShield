#!/usr/bin/env python3
"""Prints a JSON list of sample notes for local development."""
import json
import random

TITLES = ["groceries", "standup notes", "book list", "trip plan", "bug ideas", "recipes"]
TAGS = ["home", "work", "reading", "travel"]


def make_note(i: int) -> dict:
    return {
        "title": f"{random.choice(TITLES)} #{i}",
        "body": "Seeded note.",
        "tags": random.sample(TAGS, k=random.randint(0, 2)),
    }


if __name__ == "__main__":
    random.seed(7)
    print(json.dumps([make_note(i) for i in range(25)], indent=2))
