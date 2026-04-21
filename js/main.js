/* ==========================================================================
   Mystoria — main.js
   Scroll animations, navigation, and interactions
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initScrollAnimations();
    initSmoothScroll();
    initFAQ();
    initParallax();
    initTheme();
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

/* --- Scroll Parallax (hero visual) --- */
function initParallax() {
    const nodes = document.querySelectorAll('[data-parallax]');
    if (!nodes.length) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let ticking = false;
    const update = () => {
        const y = window.scrollY;
        nodes.forEach(el => {
            // Gentle rise as user scrolls: max ~-40px within first viewport
            const shift = Math.max(-40, Math.min(0, -y * 0.08));
            el.style.transform = `translate3d(0, ${shift}px, 0)`;
        });
        ticking = false;
    };

    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(update);
            ticking = true;
        }
    }, { passive: true });
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