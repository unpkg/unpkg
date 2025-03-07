/** @jsx jsx */
import { Global, css, jsx } from '@emotion/core';
import { Fragment, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import formatBytes from 'pretty-bytes';
import formatDate from 'date-fns/format';
import parseDate from 'date-fns/parse';

import { formatNumber, formatPercent } from '../utils/format.js';
import { fontSans, fontMono } from '../utils/style.js';

import { TwitterIcon, GitHubIcon } from './Icons.js';
import CloudflareLogo from './images/CloudflareLogo.png';
import FlyLogo from './images/FlyLogo.png';

const buildId = process.env.BUILD_ID;

const globalStyles = css`
  html {
    box-sizing: border-box;
  }
  *,
  *:before,
  *:after {
    box-sizing: inherit;
  }

  html,
  body,
  #root {
    height: 100%;
    margin: 0;
  }

  body {
    ${fontSans}
    font-size: 16px;
    line-height: 1.5;
    overflow-wrap: break-word;
    background: white;
    color: black;
  }

  code {
    ${fontMono}
    font-size: 1rem;
    padding: 0 3px;
    background-color: #eee;
  }

  dd,
  ul {
    margin-left: 0;
    padding-left: 25px;
  }
`;

function Link(props) {
  return (
    // eslint-disable-next-line jsx-a11y/anchor-has-content
    <a
      {...props}
      css={{
        color: '#0076ff',
        textDecoration: 'none',
        ':hover': { textDecoration: 'underline' }
      }}
    />
  );
}

function AboutLogo({ children }) {
  return <div css={{ textAlign: 'center', flex: '1' }}>{children}</div>;
}

function AboutLogoImage(props) {
  // eslint-disable-next-line jsx-a11y/alt-text
  return <img {...props} css={{ maxWidth: '90%' }} />;
}

function Stats({ data }) {
  let totals = data.totals;
  let since = parseDate(totals.since);
  let until = parseDate(totals.until);

  return (
    <p>
      From <strong>{formatDate(since, 'MMM D')}</strong> to{' '}
      <strong>{formatDate(until, 'MMM D')}</strong> unpkg served{' '}
      <strong>{formatNumber(totals.requests.all)}</strong> requests and a total
      of <strong>{formatBytes(totals.bandwidth.all)}</strong> of data to{' '}
      <strong>{formatNumber(totals.uniques.all)}</strong> unique visitors,{' '}
      <strong>
        {formatPercent(totals.requests.cached / totals.requests.all, 2)}%
      </strong>{' '}
      of which were served from the cache.
    </p>
  );
}

export default function App() {
  let [stats, setStats] = useState(
    typeof window === 'object' &&
      window.localStorage &&
      window.localStorage.savedStats
      ? JSON.parse(window.localStorage.savedStats)
      : null
  );
  let hasStats = !!(stats && !stats.error);
  let stringStats = JSON.stringify(stats);

  useEffect(() => {
    window.localStorage.savedStats = stringStats;
  }, [stringStats]);

  useEffect(() => {
    fetch('/api/stats?period=last-month')
      .then(res => res.json())
      .then(setStats);
  }, []);

  return (
    <Fragment>
      <Global styles={globalStyles} />

      <div css={{ maxWidth: 740, margin: '0 auto' }}>
        <div css={{ padding: '0 20px' }}>
          <header>
            <h1
              css={{
                textAlign: 'center',
                fontSize: '4.5em',
                letterSpacing: '0.05em',
                '@media (min-width: 700px)': {
                  marginTop: '1.5em'
                }
              }}
            >
              UNPKG
            </h1>

            <p>
              unpkg is a fast, global content delivery network for everything on{' '}
              <Link href="https://www.npmjs.com/">npm</Link>. Use it to quickly
              and easily load any file from any package using a URL like:
            </p>

            <div
              css={{
                textAlign: 'center',
                backgroundColor: '#eee',
                margin: '2em 0',
                padding: '5px 0'
              }}
            >
              unpkg.com/:package@:version/:file
            </div>

            {hasStats && <Stats data={stats} />}
          </header>

          <h3 css={{ fontSize: '1.6em' }} id="examples">
            Examples
          </h3>

          <p>Using a fixed version:</p>

          <ul>
            <li>
              <Link href="/react@16.7.0/umd/react.production.min.js">
                unpkg.com/react@16.7.0/umd/react.production.min.js
              </Link>
            </li>
            <li>
              <Link href="/react-dom@16.7.0/umd/react-dom.production.min.js">
                unpkg.com/react-dom@16.7.0/umd/react-dom.production.min.js
              </Link>
            </li>
          </ul>

          <p>
            You may also use a{' '}
            <Link href="https://docs.npmjs.com/about-semantic-versioning">semver range</Link>{' '}
            or a <Link href="https://docs.npmjs.com/cli/dist-tag">tag</Link>{' '}
            instead of a fixed version number, or omit the version/tag entirely
            to use the <code>latest</code> tag.
          </p>

          <ul>
            <li>
              <Link href="/react@^16/umd/react.production.min.js">
                unpkg.com/react@^16/umd/react.production.min.js
              </Link>
            </li>
            <li>
              <Link href="/react/index.js">
                unpkg.com/react/index.js
              </Link>
            </li>
          </ul>

          <p>
            If you omit the file path (i.e. use a &ldquo;bare&rdquo; URL), unpkg
            will serve the file specified by the <code>unpkg</code> field in{' '}
            <code>package.json</code>, or fall back to <code>main</code>.
          </p>

          <ul>
            <li>
              <Link href="/jquery">unpkg.com/jquery</Link>
            </li>
            <li>
              <Link href="/three">unpkg.com/three</Link>
            </li>
          </ul>

          <p>
            Append a <code>/</code> at the end of a URL to view a listing of all
            the files in a package.
          </p>

          <ul>
            <li>
              <Link href="/react/">unpkg.com/react/</Link>
            </li>
            <li>
              <Link href="/react-router/">unpkg.com/react-router/</Link>
            </li>
          </ul>

          <h3 css={{ fontSize: '1.6em' }} id="query-params">
            Query Parameters
          </h3>

          <dl>
            <dt>
              <code>?meta</code>
            </dt>
            <dd>
              Return metadata about any file in a package as JSON (e.g.
              <code>/any/file?meta</code>)
            </dd>

            <dt>
              <code>?module</code>
            </dt>
            <dd>
              Expands all{' '}
              <Link href="https://html.spec.whatwg.org/multipage/webappapis.html#resolve-a-module-specifier">
                &ldquo;bare&rdquo; <code>import</code> specifiers
              </Link>{' '}
              in JavaScript modules to unpkg URLs. This feature is{' '}
              <em>very experimental</em>
            </dd>
          </dl>

          <h3 css={{ fontSize: '1.6em' }} id="cache-behavior">
            Cache Behavior
          </h3>

          <p>
            The CDN caches files based on their permanent URL, which includes
            the npm package version. This works because npm does not allow
            package authors to overwrite a package that has already been
            published with a different one at the same version number.
          </p>
          <p>
            Browsers are instructed (via the <code>Cache-Control</code> header)
            to cache assets indefinitely (1 year).
          </p>
          <p>
            URLs that do not specify a package version number redirect to one
            that does. This is the <code>latest</code> version when no version
            is specified, or the <code>maxSatisfying</code> version when a{' '}
            <Link href="https://github.com/npm/node-semver">
              semver version
            </Link>{' '}
            is given. Redirects are cached for 10 minutes at the CDN, 1 minute
            in browsers.
          </p>
          <p>
            If you want users to be able to use the latest version when you cut
            a new release, the best policy is to put the version number in the
            URL directly in your installation instructions. This will also load
            more quickly because we won&apos;t have to resolve the latest
            version and redirect them.
          </p>

          <h3 css={{ fontSize: '1.6em' }} id="workflow">
            Workflow
          </h3>

          <p>
            For npm package authors, unpkg relieves the burden of publishing
            your code to a CDN in addition to the npm registry. All you need to
            do is include your{' '}
            <Link href="https://github.com/umdjs/umd">UMD</Link> build in your
            npm package (not your repo, that&apos;s different!).
          </p>

          <p>You can do this easily using the following setup:</p>

          <ul>
            <li>
              Add the <code>umd</code> (or <code>dist</code>) directory to your{' '}
              <code>.gitignore</code> file
            </li>
            <li>
              Add the <code>umd</code> directory to your{' '}
              <Link href="https://docs.npmjs.com/files/package.json#files">
                files array
              </Link>{' '}
              in <code>package.json</code>
            </li>
            <li>
              Use a build script to generate your UMD build in the{' '}
              <code>umd</code> directory when you publish
            </li>
          </ul>

          <p>
            That&apos;s it! Now when you <code>npm publish</code> you&apos;ll
            have a version available on unpkg as well.
          </p>

          <h3 css={{ fontSize: '1.6em' }} id="about">
            About
          </h3>

          <p>
            unpkg is an{' '}
            <Link href="https://github.com/mjackson/unpkg">open source</Link>{' '}
            project built and maintained by{' '}
            <Link href="https://twitter.com/mjackson">Michael Jackson</Link>.
            unpkg is not affiliated with or supported by npm, Inc. in any way.
            Please do not contact npm for help with unpkg. Instead, please reach
            out to <Link href="https://twitter.com/unpkg">@unpkg</Link> with any
            questions or concerns.
          </p>

          <p>
            The unpkg CDN is powered by{' '}
            <Link href="https://www.cloudflare.com">Cloudflare</Link>, one of
            the world&apos;s largest and fastest cloud network platforms.{' '}
            {hasStats && (
              <span>
                In the past month, Cloudflare served over{' '}
                <strong>{formatBytes(stats.totals.bandwidth.all)}</strong> to{' '}
                <strong>{formatNumber(stats.totals.uniques.all)}</strong> unique
                unpkg users all over the world.
              </span>
            )}
          </p>

          <div
            css={{
              margin: '4em 0',
              display: 'flex',
              justifyContent: 'center'
            }}
          >
            <AboutLogo>
              <a href="https://www.cloudflare.com">
                <AboutLogoImage
                  alt="Cloudflare"
                  src={CloudflareLogo}
                  height="100"
                />
              </a>
            </AboutLogo>
          </div>

          <p>
            The origin server runs on auto-scaling infrastructure provided by{' '}
            <Link href="https://fly.io/">Fly.io</Link>. The app servers run in
            17 cities around the world, and come and go based on active
            requests.
          </p>

          <div
            css={{
              margin: '4em 0 0',
              display: 'flex',
              justifyContent: 'center'
            }}
          >
            <AboutLogo>
              <a href="https://fly.io">
                <AboutLogoImage alt="Fly.io" src={FlyLogo} width="320" />
              </a>
            </AboutLogo>
          </div>
        </div>
      </div>

      <footer
        css={{
          marginTop: '5rem',
          background: 'black',
          color: '#aaa'
        }}
      >
        <div
          css={{
            maxWidth: 740,
            padding: '10px 20px',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <p>
            <span>Build: {buildId}</span>
          </p>
          <p>
            <span>&copy; {new Date().getFullYear()} UNPKG</span>
          </p>
          <p css={{ fontSize: '1.5rem' }}>
            <a
              href="https://twitter.com/unpkg"
              css={{
                color: '#aaa',
                display: 'inline-block',
                ':hover': { color: 'white' }
              }}
            >
              <TwitterIcon />
            </a>
            <a
              href="https://github.com/mjackson/unpkg"
              css={{
                color: '#aaa',
                display: 'inline-block',
                marginLeft: '1rem',
                ':hover': { color: 'white' }
              }}
            >
              <GitHubIcon />
            </a>
          </p>
        </div>
      </footer>
    </Fragment>
  );
}

if (process.env.NODE_ENV !== 'production') {
  App.propTypes = {
    location: PropTypes.object,
    children: PropTypes.node
  };
}
