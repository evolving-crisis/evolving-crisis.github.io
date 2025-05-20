# frozen_string_literal: true

source "https://rubygems.org"

# Use GitHub Pages gem to manage Jekyll and plugin versions
# Do NOT specify Jekyll or plugins separately when using github-pages
group :jekyll_plugins do
  gem "github-pages"
end

# Windows and JRuby do not include zoneinfo files, so bundle the tzinfo-data gem
platforms :mingw, :x64_mingw, :mswin, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end

# Performance booster for watching directories on Windows
# Only needed for Windows users
gem "wdm", "~> 0.1", :platforms => [:mingw, :x64_mingw, :mswin]

# Lock `http_parser.rb` gem to `v0.6.x` on JRuby builds since newer versions of the gem do not have a Java counterpart.
gem "http_parser.rb", "~> 0.6.0", :platforms => [:jruby]

gem "minima"
gem "jekyll-feed"

# Add any additional gems below this line

