# DevPulse

**A developer trend radar.** Track trending open-source GitHub repositories and popular Dev.to articles by programming language and timeframe, all in one dashboard.



![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)




![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)




![JavaScript](https://img.shields.io/badge/Vanilla%20JS-F7DF1E?logo=javascript&logoColor=black)




![No build tools](https://img.shields.io/badge/build-none-22d3ee)




![GitHub Pages](https://img.shields.io/badge/deploy-GitHub%20Pages-8b5cf6?logo=github)



**Live demo:**
https://mireli5656.github.io/DevPulse/

## Features

- **Two sources in one view.** Repositories from the GitHub Search API and top articles from the Dev.to API.
- **Language filter.** JavaScript, TypeScript, Python, Rust, Go, C++, PHP, and Java.
- **Timeframe toggle.** Weekly (7 days) or monthly (30 days).
- **View tabs.** All, GitHub Repos, Dev.to Articles, and Saved Bookmarks, each with a live count.
- **Instant filtering.** Search by title, description, or author without another network request.
- **Bookmarks.** Star any repo or article. Saved items persist in your browser and stay available when you switch language or timeframe.
- **One-click clone.** Copy a ready-to-run `git clone` command from any repo card.
- **Smart caching.** Responses are cached in LocalStorage for 15 minutes to protect API rate limits.
- **Polished UI.** Dark glassmorphism layout, skeleton loading states, empty states, and a responsive grid for mobile, tablet, and desktop.
- **Keyboard friendly.** Press `/` to focus search and `Esc` to clear it.

## Tech stack

| Area | Choice |
| --- | --- |
| Markup | HTML5 |
| Styling | Tailwind CSS (CDN) plus custom CSS in `styles.css` |
| Icons | Font Awesome 6 (CDN) |
| Font | Bricolage Grotesque (Google Fonts) |
| Logic | ES6+ Vanilla JavaScript, no framework, no bundler |
| Hosting | GitHub Pages (static files only) |

## Project structure

```text
devpulse/
├── index.html   # Layout, CDN imports, and container elements
├── styles.css   # Glassmorphism cards, skeletons, animations
├── app.js       # State, API calls, caching, bookmarks, rendering, events
└── README.md
```

## Getting started

There is nothing to install or build.

```bash
git clone https://github.com/Mireli5656/devpulse.git
cd devpulse
```

Then either open `index.html` directly in your browser, or serve the folder locally:

```bash
# Python
python -m http.server 8000

# Node
npx serve .
```

Visit `http://localhost:8000`.

## Deploy to GitHub Pages

1. Push the files to the root of your repository.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose the `main` branch and the `/ (root)` folder, then save.
5. After a minute, your site is live at `https://<your-username>.github.io/<repo-name>/`.

## How it works

### Data sources

| Source | Endpoint | Query |
| --- | --- | --- |
| GitHub | `GET /search/repositories` | `language:<lang> created:>YYYY-MM-DD`, sorted by stars, descending |
| Dev.to | `GET /api/articles` | `tag=<lang>&top=<days>` |

Both requests run in parallel. If one fails, the other still renders and a warning banner explains what went wrong.

### Caching

- Key format: `devpulse_cache_${language}_${timeframe}`
- Time to live: 15 minutes
- A valid cache entry loads instantly with no API calls.
- Failed requests are never cached, so a temporary error does not block you.
- The **Refresh** button bypasses the cache and fetches fresh data.

### Bookmarks

Bookmarks are stored under `devpulse_bookmarks` in LocalStorage. Each entry keeps the full card data, so it renders correctly even after the original results are gone from the current view. Your last language and timeframe are remembered under `devpulse_prefs`.

## Rate limits

The GitHub Search API allows roughly 10 unauthenticated requests per minute per IP. The 15-minute cache keeps normal use well below that. If you hit the limit, DevPulse shows a message and you can try again shortly. The Dev.to API needs no key for these endpoints.

## Customization

**Add a language.** Open `app.js` and add an entry to the `LANGS` object. The first value is the GitHub language qualifier and the second is the Dev.to tag:

```js
const LANGS = {
  // ...
  Kotlin: ['kotlin', 'kotlin'],
};
```

**Change the cache duration.** Edit the `TTL` constant at the top of `app.js` (value in milliseconds).

**Change colors.** Edit the CSS variables at the top of `styles.css` (`--violet`, `--cyan`, `--amber`).

## Browser support

Any modern evergreen browser (Chrome, Edge, Firefox, Safari). LocalStorage must be enabled for caching and bookmarks. If it is blocked, the app still works but does not persist data.

## Contributing

Issues and pull requests are welcome. Please keep the project free of build tools so it stays deployable straight from the repository root.

## License

Released under the [MIT License](LICENSE). Add a `LICENSE` file to your repository to match.

## Credits

Data provided by the [GitHub REST API](https://docs.github.com/en/rest) and the [Dev.to API](https://developers.forem.com/api). Icons by [Font Awesome](https://fontawesome.com). Styling with [Tailwind CSS](https://tailwindcss.com).
