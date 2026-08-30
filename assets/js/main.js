const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.site-nav');

menuButton.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!isOpen));
    menuButton.querySelector('.sr-only').textContent = isOpen ? 'Open navigation' : 'Close navigation';
    navigation.classList.toggle('is-open', !isOpen);
});

navigation.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
        menuButton.setAttribute('aria-expanded', 'false');
        menuButton.querySelector('.sr-only').textContent = 'Open navigation';
        navigation.classList.remove('is-open');
    });
});

const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
document.querySelector('#year').textContent = new Date().getFullYear();

if (window.lucide) {
    window.lucide.createIcons({ 'stroke-width': 1.8 });
}