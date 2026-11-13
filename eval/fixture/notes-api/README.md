# notes-api

A small notes service: create, list and delete notes, with session auth and an admin stats page.

## Endpoints

| Method | Path | Auth |
|---|---|---|
| GET | /notes | session |
| POST | /notes | session |
| DELETE | /notes/:id | session |
| GET | /admin/stats | admin |

## Development

Copy `.env.example` to `.env`, then run `npm start`.
