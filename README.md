# Evolving Crisis

The source for the [Evolving Crisis](https://evolving-crisis.github.io) website. The site is built with Jekyll and published through GitHub Actions to GitHub Pages.

The site currently includes the blog, an About page, and a **Study Typing** navigation tab at [`/study-typing/`](https://evolving-crisis.github.io/study-typing/). That tab displays the self-contained typing-study app from [`modules/study-typing-app/`](./modules/study-typing-app/).

## Tooling

- **Ruby**: runs Jekyll and the site plugins.
- **Bundler**: installs and invokes the exact gems declared by the project.
- **Jekyll**: converts Markdown, Liquid templates, and configuration into a static site.
- **GitHub Pages**: hosts the generated site at `https://evolving-crisis.github.io`.
- **Minima**: the site's remote theme.
- **jekyll-feed**: generates the site's RSS/Atom feed.
- **jekyll-remote-theme**: loads the Minima theme from GitHub.
- **jekyll-seo-tag**: generates SEO metadata used by Minima.
- **Study Typing App**: a static HTML/CSS/JavaScript learning module with JSON lesson packs and browser-local progress.

The [`Gemfile`](./Gemfile) declares Jekyll and its plugins individually, and [`Gemfile.lock`](./Gemfile.lock) records the resolved versions. GitHub Actions builds and deploys the site with the workflow in [`.github/workflows/pages.yml`](./.github/workflows/pages.yml).

## Prerequisites

Install the following before working on the site:

1. Git
2. Ruby
3. Bundler

Check that they are available:

```sh
git --version
ruby --version
bundle --version
```

Using a Ruby version manager such as [mise](https://mise.jdx.dev/), [rbenv](https://github.com/rbenv/rbenv), or [RubyInstaller](https://rubyinstaller.org/) on Windows is recommended. The GitHub Actions workflow uses Ruby 3.3.

## Installation

Clone the repository and enter the project directory:

```sh
git clone git@github.com:evolving-crisis/evolving-crisis.github.io.git
cd evolving-crisis.github.io
```

Install the gems from the lockfile:

```sh
bundle install
```

Bundler installs the dependencies into the configured Ruby environment. Do not run Jekyll directly from the system Ruby; use `bundle exec` so the local version matches the project lockfile.

If Bundler is not installed, install it first:

```sh
gem install bundler
```

## Run the site locally

Start the development server:

```sh
bundle exec jekyll serve
```

Open <http://localhost:4000> in a browser. Jekyll watches the source files and rebuilds the site when they change.

For automatic browser refresh while editing:

```sh
bundle exec jekyll serve --livereload
```

To use a different port or make the server accessible from another device:

```sh
bundle exec jekyll serve --port 4001 --host 0.0.0.0
```

Stop the server with `Ctrl+C`.

## Build and validate

Build the production site into `_site/`:

```sh
bundle exec jekyll build
```

For more diagnostic output when investigating a build failure:

```sh
bundle exec jekyll build --trace
```

Preview the generated files without starting Jekyll:

```sh
ruby -run -e httpd _site -p 4000
```

Remove generated files and caches:

```sh
bundle exec jekyll clean
```

Generated directories such as `_site/`, `.jekyll-cache/`, and `.sass-cache/` are ignored by Git and should not be committed.

The build includes the static files under `modules/study-typing-app/` unchanged. The module uses relative asset and lesson URLs so it works at its published subpath.

## Adding content

### Add a post

Create a file in [`_posts/`](./_posts/) using the filename format:

```text
YYYY-MM-DD-title-with-dashes.markdown
```

Add YAML front matter at the beginning of the file:

```markdown
---
title: "A descriptive title"
date: 2026-10-14
---

Write the post content here.
```

Posts support Markdown, headings, lists, links, images, and other features provided by the configured Jekyll Markdown engine.

### Add an image

Place image files in [`assets/images/`](./assets/images/) and reference them from Markdown with a site-root path:

```markdown
![Description of the image](/assets/images/example.png)
```

Use descriptive alternative text for accessibility.

### Edit site pages

- [`index.markdown`](./index.markdown) defines the home page.
- [`about.markdown`](./about.markdown) defines the About page.
- [`study-typing.markdown`](./study-typing.markdown) provides the Study Typing navigation tab.
- [`404.html`](./404.html) defines the not-found page.
- [`_config.yml`](./_config.yml) contains the site title, description, URL, theme, and plugins.
- [`modules/study-typing-app/`](./modules/study-typing-app/) contains the standalone typing-study module.

Restart `bundle exec jekyll serve` after changing `_config.yml`; Jekyll does not reload configuration changes automatically.

### Study Typing module

The module is intentionally independent of Jekyll and has no additional build
step or server dependency. It contains:

- `index.html`, `styles.css`, and `app.js` for the application;
- `lessons/index.json` and JSON lesson packs for curated content;
- browser-local custom lessons, marks, masks, preferences, and scores stored in
  `localStorage`.

The blog page at [`study-typing.markdown`](./study-typing.markdown) embeds the
module with an iframe, while the module remains directly available at
`/modules/study-typing-app/`. See the module's
[`README.md`](./modules/study-typing-app/README.md) for its behavior and local
development instructions.

## Deploy with GitHub Pages

Deployment is handled by the [GitHub Actions workflow](./.github/workflows/pages.yml), which builds the site with the individually managed Jekyll dependencies and publishes the generated Pages artifact.

### One-time repository setup

In the GitHub repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions**.
3. Save the settings.

GitHub Actions builds and publishes the site whenever changes are pushed to `main`. The public site is `https://evolving-crisis.github.io`.

### Deploy a change

Build and inspect the site locally first:

```sh
bundle exec jekyll build
```

Then commit and push the source changes:

```sh
git status
git add .
git commit -m "Describe the site change"
git push origin main
```

After the push, monitor **Settings → Pages** or the repository's deployment status for the build result. A deployment may take a few minutes to become visible.

### Optional local production-style check

To test the generated output before pushing:

```sh
bundle exec jekyll clean
bundle exec jekyll build
ruby -run -e httpd _site -p 4000
```

Visit <http://localhost:4000> and check the home page, posts, images, About page, and 404 page.

## Repository layout

```text
.
├── _config.yml          # Jekyll configuration, theme, plugins, and navigation
├── .github/workflows/pages.yml # GitHub Actions build and deployment
├── _includes/head-custom.html  # Shared favicon markup
├── _posts/              # Published posts
├── assets/images/       # Images used by posts and pages
├── modules/study-typing-app/ # Standalone typing-study module
├── about.markdown       # About page
├── study-typing.markdown # Blog page embedding the typing module
├── index.markdown       # Home page
├── favicon.svg           # Site favicon
├── 404.html             # Custom not-found page
├── Gemfile              # Ruby dependency declarations
├── Gemfile.lock         # Locked dependency versions
└── .gitignore           # Generated files excluded from Git
```

## Troubleshooting

### `bundle` or `jekyll` is not found

Install Ruby and Bundler, then run:

```sh
bundle install
```

Always use `bundle exec jekyll ...` in this project.

### Dependency or native-extension errors

Confirm the Ruby and Bundler versions, then retry:

```sh
ruby --version
bundle --version
bundle install
```

On a new platform, Bundler may need to install platform-specific native dependencies. Do not delete `Gemfile.lock` unless you intentionally want to re-resolve all dependencies. The project manages Jekyll and plugins individually; it does not use the `github-pages` gem bundle.

### A post is missing

Check that:

- the filename is `YYYY-MM-DD-title.markdown`;
- the date is not in the future;
- YAML front matter starts at the first line and is closed by a second `---`;
- the file is inside [`_posts/`](./_posts/).

### Images do not load

Use a leading `/` in the image URL and verify the filename's capitalization exactly matches the file in [`assets/images/`](./assets/images/).

## Contributing

Before opening a pull request:

1. Run `bundle install` if dependencies changed.
2. Run `bundle exec jekyll build`.
3. Run the local server and review the affected pages.
4. Confirm that generated files and local caches are not staged.
5. Describe the content or configuration change in the pull request.
