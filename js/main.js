/* ==========================================================================
   Mystoria — main.js
   Scroll animations, navigation, and interactions
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initScrollAnimations();
    initSmoothScroll();
    initFAQ();
    initTheme();
    initNotifyForm();
});

/* --- Navigation --- */
function initNav() {
    const nav = document.getElementById('nav');
    const toggle = document.getElementById('nav-toggle');
    const links = document.getElementById('nav-links');

    // Scroll state
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
        const scrollY = window.scrollY;
        nav.classList.toggle('scrolled', scrollY > 20);
        lastScroll = scrollY;
    }, { passive: true });

    // Trigger initial state
    nav.classList.toggle('scrolled', window.scrollY > 20);

    // Mobile toggle
    if (toggle && links) {
        toggle.addEventListener('click', () => {
            toggle.classList.toggle('active');
            links.classList.toggle('active');
            document.body.style.overflow = links.classList.contains('active') ? 'hidden' : '';
        });

        // Close on link click
        links.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                toggle.classList.remove('active');
                links.classList.remove('active');
                document.body.style.overflow = '';
            });
        });
    }
}

/* --- Scroll Animations --- */
function initScrollAnimations() {
    const elements = document.querySelectorAll('.animate-on-scroll');
    if (!elements.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    });

    elements.forEach(el => observer.observe(el));
}

/* --- FAQ Accordion --- */
function initFAQ() {
    document.querySelectorAll('.faq-question').forEach(button => {
        button.addEventListener('click', () => {
            const item = button.parentElement;
            const isOpen = item.classList.contains('open');

            // Close all
            document.querySelectorAll('.faq-item.open').forEach(el => {
                el.classList.remove('open');
            });

            // Toggle clicked
            if (!isOpen) {
                item.classList.add('open');
            }
        });
    });
}

/* --- Theme Toggle --- */
function initTheme() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
        const current = document.documentElement.dataset.theme || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem('theme', next);
    });

    // Sync with OS preference if user hasn't explicitly chosen
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', (e) => {
        if (localStorage.getItem('theme')) return;
        document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
    });
}

/* --- Smooth Scroll --- */
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            const href = anchor.getAttribute('href');
            if (href === '#') return;

            const target = document.querySelector(href);
            if (!target) return;

            e.preventDefault();
            const offset = 80; // nav height + padding
            const top = target.getBoundingClientRect().top + window.scrollY - offset;

            window.scrollTo({
                top: top,
                behavior: 'smooth'
            });
        });
    });
}

/* --- Launch Notification Form --- */
function initNotifyForm() {
    const form = document.getElementById('notify-form');
    if (!form) return;

    // Apps Script Web App URL — see setup/google-apps-script.gs.
    const ENDPOINT = 'https://script.google.com/macros/s/AKfycbydWkUAIRlUDjOfKYyaeF5NPQpGWskXolLqVMyFKeXXWhn9a-Hi5UAzOPxBbs1tcWg8/exec';

    const nameInput = document.getElementById('notify-name');
    const emailInput = document.getElementById('notify-email');
    const research = document.getElementById('notify-research');
    const status = document.getElementById('notify-status');
    const button = form.querySelector('.notify-submit');
    const honeypot = form.querySelector('.notify-hp');
    const fields = [nameInput, emailInput, research, button];

    const SUCCESS = "You're on the list! We'll email you when Mystoria launches.";

    const setStatus = (msg, kind) => {
        status.textContent = msg;
        status.classList.remove('is-success', 'is-error');
        if (kind) status.classList.add('is-' + kind);
    };

    const setDisabled = (state) => {
        fields.forEach((el) => { if (el) el.disabled = state; });
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();

        // Honeypot: bots fill hidden fields. Show success but never submit.
        if (honeypot && honeypot.value) {
            setStatus(SUCCESS, 'success');
            form.reset();
            return;
        }

        if (!name) {
            setStatus('Please enter your name.', 'error');
            nameInput.focus();
            return;
        }

        if (!email || !emailInput.checkValidity()) {
            setStatus('Please enter a valid email address.', 'error');
            emailInput.focus();
            return;
        }

        setDisabled(true);
        setStatus('Adding you to the list…', null);

        try {
            // Apps Script web apps don't return CORS headers, so we use
            // no-cors: the request goes through but the response is opaque.
            // A completed request is treated as success.
            await fetch(ENDPOINT, {
                method: 'POST',
                mode: 'no-cors',
                body: new URLSearchParams({
                    name: name,
                    email: email,
                    research: research && research.checked ? 'yes' : 'no',
                    source: 'my-storia.com'
                })
            });
            setStatus(SUCCESS, 'success');
            form.reset();
        } catch (err) {
            setStatus('Something went wrong. Please try again later.', 'error');
            setDisabled(false);
        }
    });
}