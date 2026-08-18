# Screenshots in the README

The [README](../README.md) puts a screenshot next to each module. They are
**uploaded to the issue tracker**, not committed: drag a PNG into any GitHub
comment box, copy the `user-attachments` URL it gives back, and paste it into
the right `<img src>`. Nothing to store in the repo.

## Capture settings

- **Mobile, 375 × 812** — the app is designed mobile-first, and a desktop
  screenshot is unreadable at 45 % of a README column.
- **Dark theme**, the app's default.
- One screen per shot, scrolled to the top, page title bar visible.

## Already there

Tasks · Money (expenses, cash flow, transactions) · Wedding (guests, vendors) ·
Wellness · Trips · Lists.

## Still missing

| Module | Page | What it should show |
|---|---|---|
| Home | `/` | The widget wall, several widgets deep |
| Calendar | `/calendar/week` | The week, with real events |
| Meals | `/repas/recettes` | The recipe grid, photos loaded |
| Shopping | `/courses` | The list grouped by aisle |
| Activities | `/tools/propositions` | Outing suggestions |
| Films | `/films/propositions` | Posters and streaming services |
| Chat | `/chat` | An exchange where Claude uses a tool |
| Make it yours | `/settings/generale` | The "Menus de navigation" card |
| Make it yours | `/settings/outils` | Followed cities + streaming services |

A module with no screenshot renders full width — add the `<table>` wrapper back
when you have one, copying any module above.

## Before you upload one

These are **your household's data**: names, addresses, balances, guests and
messages all end up on a public URL. Blur them, or shoot a demo household.
