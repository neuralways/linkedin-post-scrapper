const html = `<div class="_2391c3e5 _19a1d8a4 _2799c6e8 _7f31cd50 bc1d5cd8 _62421eee _641b48e7 _5bb08215 _4f22c9fe aa80b1eb _21968e68 _1cab6100 _96d0d3e4 _9f38cae3 _1f686e99 _4927b843 _5eefc582 _8e9be7fd _152da8c5 c25a2b32 _3b9a2e72" role="listitem">
<a href="/in/test/" aria-label="Profile">
  <figure aria-label="View Samridhi Sindhu’s profile, hiring"><img src=""/></figure>
</a>
<a aria-label="Samridhi">
  <div>
    <div><p>Samridhi Sindhu</p></div>
    <div><p>Tagline Software</p></div>
    <div><p>11h • <svg id="globe-123"></svg></p></div>
  </div>
</a>
<span data-testid="expandable-text-box">Test post text about hiring</span>
</div>`;

const { JSDOM } = require('jsdom');
const dom = new JSDOM(html);
const document = dom.window.document;

function extractPostData(postElement) {
    let author = 'Unknown';
    const actorImage = postElement.querySelector('a[data-view-name="feed-actor-image"] figure, [data-view-name="feed-actor-image"], figure[aria-label*="profile"], img[alt*="profile"]');
    const authorElement = postElement.querySelector('.update-components-actor__name, .update-components-actor__title, .feed-shared-actor__name');

    if (authorElement) {
        author = (authorElement.innerText || authorElement.textContent).trim() || author;
    } else if (actorImage && actorImage.getAttribute('aria-label')) {
        author = actorImage.getAttribute('aria-label');
    } else if (actorImage && actorImage.getAttribute('alt')) {
        author = actorImage.getAttribute('alt');
    } else {
        const appAwareLink = postElement.querySelector('a.app-aware-link[aria-label]');
        if (appAwareLink) {
            author = appAwareLink.getAttribute('aria-label').trim();
        }
    }
    author = author.replace(/^View\s+/, '').replace(/’s profile/g, '').replace(/'s profile/g, '').replace(/,.*/, '').trim();
    author = author.split('\n')[0].trim();

    let postText = '';
    const textElement = postElement.querySelector(
        '.update-components-text, ' +
        '.feed-shared-update-v2__description, ' +
        '[data-view-name="feed-commentary"], ' +
        '[data-testid="expandable-text-box"], ' +
        '.feed-shared-update-v2__commentary, ' +
        '.update-components-update-v2__commentary'
    );
    if (textElement) {
        postText = (textElement.textContent || '').trim();
    }

    let dateTime = 'Unknown';
    const timeElement = postElement.querySelector('a.app-aware-link > time, span.update-components-actor__sub-description, .feed-shared-actor__sub-description');
    if (timeElement) {
        dateTime = timeElement.textContent.trim().split('•')[0].trim();
    } else {
        const globes = postElement.querySelectorAll('svg[id^="globe-"], svg[id^="people-"]');
        for (let svg of globes) {
            const p = svg.closest('p');
            if (p) {
                const textContent = p.textContent.trim();
                if (textContent.includes('•')) {
                    dateTime = textContent.split('•')[0].trim();
                    break;
                }
            }
        }
    }
    dateTime = dateTime.split('\n')[0].trim();

    let company = '';
    const actorLink = postElement.querySelector('a[data-view-name="feed-actor-image"]');
    if (actorLink && actorLink.nextElementSibling) {
        const ps = actorLink.nextElementSibling.querySelectorAll('p');
        if (ps.length >= 2) {
            company = ps[1].textContent.trim();
        }
    } else {
        const globes = postElement.querySelectorAll('svg[id^="globe-"], svg[id^="people-"]');
        for (let svg of globes) {
            const pDate = svg.closest('p');
            if (pDate && pDate.closest('a')) {
                const allPs = pDate.closest('a').querySelectorAll('p');
                for (let i = 0; i < allPs.length; i++) {
                    if (allPs[i] === pDate && i > 0) {
                        company = allPs[i - 1].textContent.trim();
                    }
                }
            }
        }
    }
    if (company) {
        company = company.split('\n')[0].trim();
    }

    return { author, postText: postText.substring(0, 30), dateTime, company };
}

const posts = document.querySelectorAll('div[role="listitem"]');
console.log('Posts found: ' + posts.length);
posts.forEach((p, i) => console.log('Post ' + i + ':', extractPostData(p)));
