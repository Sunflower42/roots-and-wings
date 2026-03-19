/**
 * Roots & Wings Indy — script.js
 * Vanilla JavaScript for navigation, scroll animations, and member portal auth.
 */

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // 1. Mobile Navigation Toggle
  // ──────────────────────────────────────────────
  document.querySelectorAll('.nav-toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function () {
      var expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', String(!expanded));
      this.classList.toggle('open');

      // Find the sibling nav-links within the same navbar
      var navLinks = this.closest('.navbar').querySelector('.nav-links');
      if (navLinks) {
        navLinks.classList.toggle('open');
      }
    });
  });

  // Close mobile menu when a link is clicked
  document.querySelectorAll('.nav-links a').forEach(function (link) {
    link.addEventListener('click', function () {
      var navLinks = this.closest('.nav-links');
      var toggle = this.closest('.navbar').querySelector('.nav-toggle');
      if (navLinks && navLinks.classList.contains('open')) {
        navLinks.classList.remove('open');
        if (toggle) {
          toggle.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      }
    });
  });

  // ──────────────────────────────────────────────
  // 2. Navbar scroll effect
  // ──────────────────────────────────────────────
  var navbar = document.querySelector('.navbar');
  if (navbar && !navbar.classList.contains('scrolled')) {
    var onScroll = function () {
      if (window.scrollY > 40) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ──────────────────────────────────────────────
  // 3. Scroll-triggered fade-in animations
  // ──────────────────────────────────────────────
  var fadeEls = document.querySelectorAll('.fade-in');

  if (fadeEls.length > 0 && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    fadeEls.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    // Fallback: show everything immediately
    fadeEls.forEach(function (el) {
      el.classList.add('visible');
    });
  }

  // ──────────────────────────────────────────────
  // 4. Active nav link highlighting (public site)
  // ──────────────────────────────────────────────
  var sections = document.querySelectorAll('section[id]');
  var navLinksForHighlight = document.querySelectorAll('.navbar .nav-links a[href^="#"]');

  if (sections.length > 0 && navLinksForHighlight.length > 0) {
    var highlightNav = function () {
      var scrollPos = window.scrollY + 120;
      sections.forEach(function (section) {
        var top = section.offsetTop;
        var height = section.offsetHeight;
        var id = section.getAttribute('id');

        if (scrollPos >= top && scrollPos < top + height) {
          navLinksForHighlight.forEach(function (link) {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + id) {
              link.classList.add('active');
            }
          });
        }
      });
    };
    window.addEventListener('scroll', highlightNav, { passive: true });
  }

  // ──────────────────────────────────────────────
  // 5. Member Portal Authentication
  // ──────────────────────────────────────────────
  //
  // IMPORTANT: This is a client-side password check for demo/development
  // purposes ONLY. It provides NO real security. For production, replace
  // with Google OAuth (e.g., Firebase Auth with Google sign-in) to
  // authenticate against the co-op's Google Workspace domain.
  //

  var loginForm = document.getElementById('loginForm');
  var loginSection = document.getElementById('loginSection');
  var dashboard = document.getElementById('dashboard');
  var loginError = document.getElementById('loginError');
  var passwordInput = document.getElementById('password');
  var logoutBtn = document.getElementById('logoutBtn');

  // The demo password — NOT SECURE, replace with real auth
  var DEMO_PASSWORD = 'rootsandwings2026';
  var SESSION_KEY = 'rw_member_auth';

  function showDashboard() {
    if (loginSection) loginSection.style.display = 'none';
    if (dashboard) dashboard.classList.add('visible');
    // Re-trigger fade-in observer for dashboard elements
    var dashFades = dashboard ? dashboard.querySelectorAll('.fade-in') : [];
    if (dashFades.length > 0 && 'IntersectionObserver' in window) {
      var dashObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('visible');
              dashObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
      );
      dashFades.forEach(function (el) {
        dashObserver.observe(el);
      });
    } else {
      dashFades.forEach(function (el) {
        el.classList.add('visible');
      });
    }
  }

  function showLogin() {
    if (loginSection) loginSection.style.display = '';
    if (dashboard) dashboard.classList.remove('visible');
    sessionStorage.removeItem(SESSION_KEY);
  }

  // Check for existing session
  if (loginSection && dashboard) {
    if (sessionStorage.getItem(SESSION_KEY) === 'true') {
      showDashboard();
    }

    // Login form submission
    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var pw = passwordInput ? passwordInput.value : '';

        if (pw === DEMO_PASSWORD) {
          sessionStorage.setItem(SESSION_KEY, 'true');
          if (loginError) loginError.classList.remove('visible');
          if (passwordInput) passwordInput.classList.remove('error');
          showDashboard();
        } else {
          if (loginError) loginError.classList.add('visible');
          if (passwordInput) {
            passwordInput.classList.add('error');
            passwordInput.focus();
            passwordInput.select();
          }
        }
      });
    }

    // Logout
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        showLogin();
        if (passwordInput) passwordInput.value = '';
        window.scrollTo(0, 0);
      });
    }
  }

  // ──────────────────────────────────────────────
  // 6. Smooth scroll for anchor links (fallback)
  // ──────────────────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var targetId = this.getAttribute('href');
      if (targetId === '#' || targetId.length < 2) return;

      var target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ──────────────────────────────────────────────
  // Tour Modal — close on Escape key
  // ──────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var modal = document.getElementById('tour-modal');
      if (modal && modal.classList.contains('active')) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
      }
      // Also close style switcher
      var panel = document.querySelector('.style-switcher-panel');
      if (panel) panel.classList.remove('open');
    }
  });

  // ──────────────────────────────────────────────
  // 7. Portal — Tabs
  // ──────────────────────────────────────────────
  document.querySelectorAll('.portal-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var tabId = this.getAttribute('data-tab');
      this.closest('.portal-tabs').querySelectorAll('.portal-tab').forEach(function (t) {
        t.classList.remove('active');
      });
      this.closest('.portal-tabs').querySelectorAll('.portal-tab-panel').forEach(function (p) {
        p.classList.remove('active');
      });
      this.classList.add('active');
      var panel = document.getElementById('tab-' + tabId);
      if (panel) panel.classList.add('active');
    });
  });

  // ──────────────────────────────────────────────
  // 7b. Yearbook Directory
  // ──────────────────────────────────────────────

  // Color palette for initials circles (deterministic by first letter)
  var FACE_COLORS = [
    ['#2D6A3F','#8DB43E'], ['#5BACC8','#2D6A3F'], ['#D4712A','#E8A628'],
    ['#6B4E71','#B68CB5'], ['#5B8A8D','#7A9E7E'], ['#C4847A','#D4915E'],
    ['#3D6B6E','#5BACC8'], ['#B07348','#E8A628'], ['#4E3754','#6B4E71']
  ];

  function faceColor(name) {
    var i = (name.charCodeAt(0) + (name.length > 1 ? name.charCodeAt(1) : 0)) % FACE_COLORS.length;
    return 'linear-gradient(135deg,' + FACE_COLORS[i][0] + ',' + FACE_COLORS[i][1] + ')';
  }

  // Class staff — liaison (year-long), teacher + assistants per session
  // currentSession controls which session's teacher/assistants are shown
  var currentSession = 3; // 1–5
  var CLASS_STAFF = {
    'Greenhouse': {
      room: 'Patience',
      ages: '0–2',
      note: 'No programming',
      liaison: 'Ashley Brooks',
      sessions: [
        {teacher:'Rachel Adams', assistants:['Angela Carter']},
        {teacher:'Angela Carter', assistants:['Rachel Adams']},
        {teacher:'Lisa Chen', assistants:['Brittany Coleman']},
        {teacher:'Rachel Adams', assistants:['Lisa Chen']},
        {teacher:'Angela Carter', assistants:['Ashley Brooks']}
      ]
    },
    'Saplings': {
      room: 'Faithfulness',
      ages: '3–5',
      liaison: 'Laura Campbell',
      sessions: [
        {teacher:'Jen Baker', assistants:['Amy Foster']},
        {teacher:'Amy Foster', assistants:['Jen Baker']},
        {teacher:'Kevin Ellis', assistants:['Amanda Fisher']},
        {teacher:'Amanda Fisher', assistants:['Laura Campbell']},
        {teacher:'Jen Baker', assistants:['Kevin Ellis']}
      ]
    },
    'Sassafras': {
      room: 'Kindness',
      ages: '5–6',
      liaison: 'Danielle Graves',
      sessions: [
        {teacher:'Rachel Adams', assistants:['Danielle Graves']},
        {teacher:'Nicole Keller', assistants:['Tiffany Morris']},
        {teacher:'Danielle Graves', assistants:['Rachel Adams']},
        {teacher:'Tiffany Morris', assistants:['Nicole Keller']},
        {teacher:'Shannon Quinn', assistants:['Danielle Graves']}
      ]
    },
    'Oaks': {
      room: 'Multi-Purpose Room',
      ages: '7–8',
      liaison: 'Maria Garcia',
      sessions: [
        {teacher:'Sarah Anderson', assistants:['Brittany Coleman']},
        {teacher:'Maria Garcia', assistants:['Kevin Ellis']},
        {teacher:'Gabriela Martinez', assistants:['Erica Patterson']},
        {teacher:'Soo-Yun Kim', assistants:['Maria Garcia']},
        {teacher:'Kristen Henderson', assistants:['Sarah Anderson']}
      ]
    },
    'Maples': {
      room: 'Kitchen',
      ages: '8–9',
      liaison: 'Kim Johnson',
      sessions: [
        {teacher:'DeShawn Barnes', assistants:['Lisa Chen']},
        {teacher:'Kim Johnson', assistants:['Latasha Jackson']},
        {teacher:'Latasha Jackson', assistants:['Denise Mitchell']},
        {teacher:'Denise Mitchell', assistants:['Kim Johnson']},
        {teacher:'Lisa Chen', assistants:['DeShawn Barnes']}
      ]
    },
    'Birch': {
      room: 'Patience',
      ages: '9–10',
      liaison: 'Tamara Dixon',
      sessions: [
        {teacher:'Rachel Davis', assistants:['Tamara Dixon']},
        {teacher:'Eric Collins', assistants:['Linh Nguyen']},
        {teacher:'Tamara Dixon', assistants:['Cassandra Owens']},
        {teacher:'Cassandra Owens', assistants:['Rachel Davis']},
        {teacher:'Linh Nguyen', assistants:['Eric Collins']}
      ]
    },
    'Willows': {
      room: 'Faithfulness',
      ages: '10–11',
      liaison: 'Heather Lawson',
      sessions: [
        {teacher:'Courtney Bennett', assistants:['Tonya Harris']},
        {teacher:'Heather Lawson', assistants:['Megan Sullivan']},
        {teacher:'Tonya Harris', assistants:['Heather Lawson']},
        {teacher:'Megan Sullivan', assistants:['Courtney Bennett']},
        {teacher:'Courtney Bennett', assistants:['Linh Nguyen']}
      ]
    },
    'Cedars': {
      room: 'Kindness',
      ages: '12–13',
      liaison: 'Amy Foster',
      sessions: [
        {teacher:'Marcus Brooks', assistants:['Monica Crawford']},
        {teacher:'Elena Ramirez', assistants:['Amy Foster']},
        {teacher:'Amy Foster', assistants:['Marcus Brooks']},
        {teacher:'Monica Crawford', assistants:['Elena Ramirez']},
        {teacher:'Marcus Brooks', assistants:['Monica Crawford']}
      ]
    },
    'Pigeons': {
      room: 'Multi-Purpose Room',
      ages: '14+',
      liaison: 'Kendra Robinson',
      sessions: [
        {teacher:'Keisha Washington', assistants:['Kendra Robinson']},
        {teacher:'Kendra Robinson', assistants:['Heather Lawson']},
        {teacher:'Heather Lawson', assistants:['Keisha Washington']},
        {teacher:'Kim Johnson', assistants:['Cassandra Owens']},
        {teacher:'Cassandra Owens', assistants:['Kim Johnson']}
      ]
    }
  };

  // Family data — will be replaced by Google Sheet CSV when connected
  // Kid fields: name, age, group, pronouns, allergies (empty string = none)
  var FAMILIES = [
    {name:'Adams',parents:'Rachel & Tom',parentPronouns:{'Rachel':'she/her'},email:'adams@email.com',phone:'(317) 555-0101',kids:[
      {name:'Zoe',age:6,group:'Sassafras',pronouns:'',allergies:''},
      {name:'Caleb',age:10,group:'Birch',pronouns:'',allergies:'peanut, tree nut'}]},
    {name:'Anderson',parents:'Sarah & Mike',email:'anderson@email.com',phone:'(317) 555-0102',kids:[
      {name:'Emma',age:7,group:'Oaks',pronouns:'',allergies:''},
      {name:'Liam',age:10,group:'Birch',pronouns:'',allergies:''}]},
    {name:'Baker',parents:'Jen',email:'baker@email.com',phone:'(317) 555-0103',kids:[
      {name:'Olivia',age:5,group:'Saplings',pronouns:'',allergies:'dairy'},
      {name:'Noah',age:8,group:'Oaks',pronouns:'',allergies:'dairy'},
      {name:'Ava',age:12,group:'Cedars',pronouns:'',allergies:''}]},
    {name:'Barnes',parents:'DeShawn & Tanya',email:'barnes@email.com',phone:'(317) 555-0104',kids:[
      {name:'Jaylen',age:3,group:'Saplings',pronouns:'',allergies:''},
      {name:'Nia',age:9,group:'Maples',pronouns:'',allergies:''}]},
    {name:'Bennett',parents:'Courtney',email:'bennett@email.com',phone:'(317) 555-0105',kids:[
      {name:'Harper',age:11,group:'Willows',pronouns:'she/her',allergies:'bee sting (EpiPen in backpack)',lastName:'Reeves'}]},
    {name:'Brooks',parents:'Marcus & Ashley',email:'brooks@email.com',phone:'(317) 555-0106',kids:[
      {name:'Micah',age:1,group:'Greenhouse',pronouns:'',allergies:'egg'},
      {name:'Trinity',age:5,group:'Saplings',pronouns:'',allergies:''},
      {name:'Jordan',age:13,group:'Cedars',pronouns:'they/them',allergies:'',schedule:'morning'}]},
    {name:'Campbell',parents:'Laura',email:'campbell@email.com',phone:'(317) 555-0107',kids:[
      {name:'Owen',age:4,group:'Saplings',pronouns:'',allergies:''},
      {name:'Hazel',age:8,group:'Oaks',pronouns:'',allergies:''}]},
    {name:'Carter',parents:'Angela & Brian',email:'carter@email.com',phone:'(317) 555-0108',kids:[
      {name:'Maya',age:6,group:'Sassafras',pronouns:'',allergies:'gluten'},
      {name:'Elijah',age:9,group:'Maples',pronouns:'',allergies:''},
      {name:'Norah',age:14,group:'Pigeons',pronouns:'',allergies:'',schedule:'afternoon'}]},
    {name:'Chen',parents:'Lisa & David',email:'chen@email.com',phone:'(317) 555-0109',kids:[
      {name:'Sophia',age:9,group:'Maples',pronouns:'',allergies:''}]},
    {name:'Coleman',parents:'Brittany',email:'coleman@email.com',phone:'(317) 555-0110',kids:[
      {name:'Aiden',age:7,group:'Oaks',pronouns:'',allergies:'peanut'},
      {name:'Lily',age:12,group:'Cedars',pronouns:'',allergies:''}]},
    {name:'Collins',parents:'Eric & Vanessa',email:'collins@email.com',phone:'(317) 555-0111',kids:[
      {name:'Isla',age:2,group:'Greenhouse',pronouns:'',allergies:''},
      {name:'Kai',age:5,group:'Saplings',pronouns:'he/him',allergies:''},
      {name:'Roman',age:10,group:'Birch',pronouns:'',allergies:''},
      {name:'Sienna',age:14,group:'Pigeons',pronouns:'',allergies:'shellfish'}]},
    {name:'Crawford',parents:'Monica',email:'crawford@email.com',phone:'(317) 555-0112',kids:[
      {name:'Jasper',age:8,group:'Oaks',pronouns:'',allergies:''}]},
    {name:'Davis',parents:'Rachel & Nathan',email:'davis@email.com',phone:'(317) 555-0113',kids:[
      {name:'Chloe',age:3,group:'Saplings',pronouns:'',allergies:''},
      {name:'Leo',age:6,group:'Sassafras',pronouns:'',allergies:''},
      {name:'Mila',age:11,group:'Willows',pronouns:'',allergies:''}]},
    {name:'Dixon',parents:'Tamara',email:'dixon@email.com',phone:'(317) 555-0114',kids:[
      {name:'Ezra',age:10,group:'Birch',pronouns:'',allergies:''},
      {name:'Ivy',age:13,group:'Cedars',pronouns:'',allergies:''}]},
    {name:'Ellis',parents:'Kevin & Priya',parentPronouns:{'Kevin':'he/him','Priya':'she/her'},email:'ellis@email.com',phone:'(317) 555-0115',kids:[
      {name:'Rowan',age:4,group:'Saplings',pronouns:'they/them',allergies:''},
      {name:'Sadie',age:7,group:'Oaks',pronouns:'',allergies:''}]},
    {name:'Fisher',parents:'Amanda',email:'fisher@email.com',phone:'(317) 555-0116',kids:[
      {name:'Theo',age:1,group:'Greenhouse',pronouns:'',allergies:''},
      {name:'Clara',age:5,group:'Saplings',pronouns:'',allergies:'egg'}]},
    {name:'Foster',parents:'Amy & Chris',email:'foster@email.com',phone:'(317) 555-0117',kids:[
      {name:'Ethan',age:4,group:'Saplings',pronouns:'',allergies:''},
      {name:'Isabella',age:7,group:'Oaks',pronouns:'',allergies:''},
      {name:'Mason',age:13,group:'Cedars',pronouns:'',allergies:''}]},
    {name:'Garcia',parents:'Maria & Carlos',email:'garcia@email.com',phone:'(317) 555-0118',kids:[
      {name:'Sofia',age:8,group:'Oaks',pronouns:'',allergies:''},
      {name:'Mateo',age:12,group:'Cedars',pronouns:'',allergies:''}]},
    {name:'Graves',parents:'Danielle',email:'graves@email.com',phone:'(317) 555-0119',kids:[
      {name:'Piper',age:6,group:'Sassafras',pronouns:'',allergies:''},
      {name:'Beckett',age:9,group:'Maples',pronouns:'',allergies:'tree nut'}]},
    {name:'Harris',parents:'Tonya & James',email:'harris@email.com',phone:'(317) 555-0120',kids:[
      {name:'Aaliyah',age:2,group:'Greenhouse',pronouns:'',allergies:''},
      {name:'Xavier',age:7,group:'Oaks',pronouns:'',allergies:''},
      {name:'Naomi',age:11,group:'Willows',pronouns:'she/her',allergies:'dairy'}]},
    {name:'Henderson',parents:'Kristen',email:'henderson@email.com',phone:'(317) 555-0121',kids:[
      {name:'Wyatt',age:5,group:'Saplings',pronouns:'',allergies:''},
      {name:'Ruby',age:8,group:'Oaks',pronouns:'',allergies:''},
      {name:'Finn',age:14,group:'Pigeons',pronouns:'',allergies:'',schedule:'afternoon'}]},
    {name:'Hughes',parents:'Ben & Stephanie',email:'hughes@email.com',phone:'(317) 555-0122',kids:[
      {name:'Archer',age:3,group:'Saplings',pronouns:'',allergies:''},
      {name:'Violet',age:10,group:'Birch',pronouns:'',allergies:''}]},
    {name:'Jackson',parents:'Latasha',email:'jackson@email.com',phone:'(317) 555-0123',kids:[
      {name:'Miles',age:9,group:'Maples',pronouns:'',allergies:''},
      {name:'Sage',age:13,group:'Cedars',pronouns:'they/them',allergies:'',lastName:'Thornton',schedule:'morning'}]},
    {name:'Johnson',parents:'Kim & Matt',email:'johnson@email.com',phone:'(317) 555-0124',kids:[
      {name:'Amelia',age:9,group:'Maples',pronouns:'',allergies:''},
      {name:'Henry',age:14,group:'Pigeons',pronouns:'',allergies:'peanut'}]},
    {name:'Keller',parents:'Nicole & Greg',email:'keller@email.com',phone:'(317) 555-0125',kids:[
      {name:'Iris',age:1,group:'Greenhouse',pronouns:'',allergies:''},
      {name:'Eli',age:6,group:'Sassafras',pronouns:'',allergies:''},
      {name:'Luna',age:10,group:'Birch',pronouns:'',allergies:''}]},
    {name:'Kim',parents:'Soo-Yun & Daniel',email:'kim@email.com',phone:'(317) 555-0126',kids:[
      {name:'Hana',age:4,group:'Saplings',pronouns:'',allergies:''},
      {name:'Jude',age:8,group:'Oaks',pronouns:'',allergies:''}]},
    {name:'Lawson',parents:'Heather',email:'lawson@email.com',phone:'(317) 555-0127',kids:[
      {name:'Sawyer',age:11,group:'Willows',pronouns:'he/him',allergies:''},
      {name:'Daisy',age:14,group:'Pigeons',pronouns:'',allergies:''}]},
    {name:'Martinez',parents:'Gabriela & Jose',email:'martinez@email.com',phone:'(317) 555-0128',kids:[
      {name:'Diego',age:3,group:'Saplings',pronouns:'',allergies:''},
      {name:'Camila',age:7,group:'Oaks',pronouns:'',allergies:''},
      {name:'Lucia',age:12,group:'Cedars',pronouns:'',allergies:''}]},
    {name:'Mitchell',parents:'Denise',email:'mitchell@email.com',phone:'(317) 555-0129',kids:[
      {name:'Blake',age:5,group:'Saplings',pronouns:'',allergies:''},
      {name:'Wren',age:9,group:'Maples',pronouns:'',allergies:''}]},
    {name:'Morris',parents:'Tiffany & Andre',email:'morris@email.com',phone:'(317) 555-0130',kids:[
      {name:'Zion',age:2,group:'Greenhouse',pronouns:'',allergies:''},
      {name:'Aria',age:6,group:'Sassafras',pronouns:'',allergies:''}]},
    {name:'Nguyen',parents:'Linh & Tuan',email:'nguyen@email.com',phone:'(317) 555-0131',kids:[
      {name:'Minh',age:8,group:'Oaks',pronouns:'',allergies:''},
      {name:'An',age:11,group:'Willows',pronouns:'',allergies:''}]},
    {name:'Owens',parents:'Cassandra',email:'owens@email.com',phone:'(317) 555-0132',kids:[
      {name:'Felix',age:7,group:'Oaks',pronouns:'',allergies:''},
      {name:'Stella',age:10,group:'Birch',pronouns:'',allergies:'gluten'},
      {name:'Gus',age:14,group:'Pigeons',pronouns:'',allergies:''}]},
    {name:'Palmer',parents:'Jessica & Ryan',email:'palmer@email.com',phone:'(317) 555-0133',kids:[
      {name:'Olive',age:1,group:'Greenhouse',pronouns:'',allergies:''},
      {name:'August',age:5,group:'Saplings',pronouns:'',allergies:''},
      {name:'Scarlett',age:9,group:'Maples',pronouns:'',allergies:''}]},
    {name:'Patterson',parents:'Erica',email:'patterson@email.com',phone:'(317) 555-0134',kids:[
      {name:'Nolan',age:4,group:'Saplings',pronouns:'',allergies:''},
      {name:'Poppy',age:7,group:'Oaks',pronouns:'',allergies:''}]},
    {name:'Quinn',parents:'Shannon & Derek',email:'quinn@email.com',phone:'(317) 555-0135',kids:[
      {name:'Levi',age:6,group:'Sassafras',pronouns:'',allergies:''},
      {name:'Margot',age:12,group:'Cedars',pronouns:'',allergies:''}]},
    {name:'Ramirez',parents:'Elena',email:'ramirez@email.com',phone:'(317) 555-0136',kids:[
      {name:'Dante',age:3,group:'Saplings',pronouns:'',allergies:''},
      {name:'Valentina',age:8,group:'Oaks',pronouns:'',allergies:''},
      {name:'Cruz',age:13,group:'Cedars',pronouns:'',allergies:''}]},
    {name:'Robinson',parents:'Kendra & Marcus',email:'robinson@email.com',phone:'(317) 555-0137',kids:[
      {name:'Jada',age:10,group:'Birch',pronouns:'',allergies:''},
      {name:'Elias',age:14,group:'Pigeons',pronouns:'',allergies:''}]},
    {name:'Sullivan',parents:'Megan & Patrick',parentPronouns:{'Megan':'she/her'},email:'sullivan@email.com',phone:'(317) 555-0138',kids:[
      {name:'Fiona',age:2,group:'Greenhouse',pronouns:'',allergies:''},
      {name:'Declan',age:7,group:'Oaks',pronouns:'',allergies:''},
      {name:'Maeve',age:11,group:'Willows',pronouns:'',allergies:''}]},
    {name:'Taylor',parents:'Christine',email:'taylor@email.com',phone:'(317) 555-0139',kids:[
      {name:'Asher',age:5,group:'Saplings',pronouns:'',allergies:''},
      {name:'Juniper',age:9,group:'Maples',pronouns:'',allergies:''},
      {name:'Silas',age:12,group:'Cedars',pronouns:'',allergies:''}]},
    {name:'Washington',parents:'Keisha & Robert',email:'washington@email.com',phone:'(317) 555-0140',kids:[
      {name:'Imani',age:6,group:'Sassafras',pronouns:'',allergies:''},
      {name:'Malcolm',age:10,group:'Birch',pronouns:'',allergies:''},
      {name:'Zara',age:14,group:'Pigeons',pronouns:'',allergies:''}]},
    // Board member families (stub data)
    {name:'Bellner',parents:'Molly & Jake',email:'bellner@email.com',phone:'(317) 555-0141',boardRole:'President',boardEmail:'president@rootsandwingsindy.com',kids:[
      {name:'Rosie',age:7,group:'Oaks',pronouns:'',allergies:''},
      {name:'Sam',age:11,group:'Willows',pronouns:'',allergies:''}]},
    {name:'Raymont',parents:'Colleen & Travis',email:'raymont@email.com',phone:'(317) 555-0142',boardRole:'Vice President',boardEmail:'vp@rootsandwingsindy.com',kids:[
      {name:'Nora',age:5,group:'Saplings',pronouns:'',allergies:''},
      {name:'Will',age:9,group:'Maples',pronouns:'',allergies:'peanut'}]},
    {name:'Smith',parents:'Tiffany & Dan',email:'smith@email.com',phone:'(317) 555-0143',boardRole:'Membership Director',boardEmail:'membership@rootsandwingsindy.com',kids:[
      {name:'Lena',age:8,group:'Oaks',pronouns:'she/her',allergies:''},
      {name:'Caleb',age:13,group:'Cedars',pronouns:'',allergies:''}]},
    {name:'Shewan',parents:'Jessica & Patrick',email:'shewan@email.com',phone:'(317) 555-0144',boardRole:'Treasurer',boardEmail:'treasurer@rootsandwingsindy.com',kids:[
      {name:'Claire',age:4,group:'Saplings',pronouns:'',allergies:'dairy'},
      {name:'Gavin',age:10,group:'Birch',pronouns:'',allergies:''}]},
    {name:'Billingsley',parents:'Anna & Jeff',email:'billingsley@email.com',phone:'(317) 555-0145',boardRole:'Sustaining Director',boardEmail:'sustaining@rootsandwingsindy.com',kids:[
      {name:'Theo',age:6,group:'Sassafras',pronouns:'',allergies:''},
      {name:'Iris',age:12,group:'Cedars',pronouns:'she/her',allergies:''}]},
    {name:'Newlin',parents:'LeAnn & Doug',email:'newlin@email.com',phone:'(317) 555-0146',boardRole:'Secretary',boardEmail:'secretary@rootsandwingsindy.com',kids:[
      {name:'Bea',age:3,group:'Saplings',pronouns:'',allergies:''},
      {name:'Hugo',age:8,group:'Oaks',pronouns:'',allergies:'tree nut'}]},
    {name:'Bogan',parents:'Erin & Scott',email:'bogan@email.com',phone:'(317) 555-0147',boardRole:'Communications Director',boardEmail:'communications@rootsandwingsindy.com',kids:[
      {name:'Willa',age:5,group:'Saplings',pronouns:'',allergies:''},
      {name:'Teddy',age:9,group:'Maples',pronouns:'',allergies:''},
      {name:'June',age:14,group:'Pigeons',pronouns:'she/her',allergies:''}]}
  ];

  // Build flat list of all people (parents + kids) for the yearbook
  var allPeople = [];
  FAMILIES.forEach(function (fam) {
    var parentNames = fam.parents.split(' & ');
    var pp = fam.parentPronouns || {};
    // Collect kids with different last names for parent display
    var diffNameKids = fam.kids.filter(function(k) { return k.lastName && k.lastName !== fam.name; });
    parentNames.forEach(function (pName) {
      allPeople.push({
        name: pName.trim(),
        type: 'parent',
        family: fam.name,
        email: fam.email,
        phone: fam.phone,
        group: null,
        age: null,
        pronouns: pp[pName.trim()] || '',
        allergies: '',
        schedule: 'all-day',
        parentNames: fam.parents,
        diffNameKids: diffNameKids,
        kidNames: fam.kids.map(function(k) { return k.name + ' ' + (k.lastName || fam.name); })
      });
    });
    fam.kids.forEach(function (kid) {
      allPeople.push({
        name: kid.name,
        lastName: kid.lastName || fam.name, // defaults to family name
        type: 'kid',
        family: fam.name,
        email: fam.email,
        phone: fam.phone,
        group: kid.group,
        age: kid.age,
        pronouns: kid.pronouns || '',
        allergies: kid.allergies || '',
        schedule: kid.schedule || 'all-day',
        parentNames: fam.parents
      });
    });
  });

  var directoryGrid = document.getElementById('directoryGrid');
  var directorySearch = document.getElementById('directorySearch');
  var directoryCount = document.getElementById('directoryCount');
  var personDetail = document.getElementById('personDetail');
  var personDetailCard = document.getElementById('personDetailCard');
  var activeFilter = 'parents';

  // Helper: find a person in allPeople by full name (first + family)
  function findPersonByFullName(fullName) {
    var parts = fullName.split(' ');
    var first = parts[0];
    var last = parts.slice(1).join(' ');
    for (var i = 0; i < allPeople.length; i++) {
      if (allPeople[i].name === first && allPeople[i].family === last) return {person: allPeople[i], idx: i};
    }
    return null;
  }

  // Helper: build a clickable staff member chip
  function staffChip(fullName, role) {
    var found = findPersonByFullName(fullName);
    var tag = found ? 'button' : 'span';
    var dataAttr = found ? ' data-staff-idx="' + found.idx + '"' : '';
    var pronouns = found && found.person.pronouns ? ' <em class="staff-pronouns">(' + found.person.pronouns + ')</em>' : '';
    return '<' + tag + ' class="staff-role"' + dataAttr + '>' +
      '<div class="staff-dot" style="background:' + faceColor(fullName) + '"><span>' + fullName.charAt(0) + '</span></div>' +
      '<div class="staff-label"><strong>' + fullName + pronouns + '</strong><small>' + role + '</small></div>' +
      '</' + tag + '>';
  }

  // Is this a class/group filter?
  function isGroupFilter(f) {
    return f !== 'all' && f !== 'parents' && CLASS_STAFF[f];
  }

  function renderDirectory() {
    if (!directoryGrid) return;
    var query = (directorySearch ? directorySearch.value : '').toLowerCase();
    var staff = CLASS_STAFF[activeFilter];
    var isClassView = isGroupFilter(activeFilter) && !query;
    var html = '';
    var shown = 0;

    // ---- Class view (group filter, no search) — cards with extra info ----
    if (isClassView) {
      // Staff banner with room + age info
      var sess = staff.sessions[currentSession - 1];
      html += '<div class="class-staff-banner">';
      html += '<div class="class-staff-header">';
      html += '<span class="class-staff-title">' + activeFilter + '</span>';
      html += '<span class="class-staff-meta">Room: ' + staff.room + ' &middot; Ages ' + staff.ages;
      if (staff.note) html += ' &middot; ' + staff.note;
      html += '</span>';
      html += '</div>';
      html += '<div class="class-staff-roles">';
      html += staffChip(staff.liaison, 'Liaison (year-long)');
      if (sess) {
        html += staffChip(sess.teacher, 'Teacher (Session ' + currentSession + ')');
        sess.assistants.forEach(function (a) {
          html += staffChip(a, 'Assistant (Session ' + currentSession + ')');
        });
      }
      html += '</div></div>';

      // Face cards for kids in this group (excluding afternoon-only)
      allPeople.forEach(function (person, idx) {
        if (person.type !== 'kid' || person.group !== activeFilter) return;
        if (person.schedule === 'afternoon') return;

        var displayName = person.lastName && person.lastName !== person.family
          ? person.name + ' ' + person.lastName
          : person.name;
        var bgStyle = faceColor(person.name);
        var extras = '';
        if (person.pronouns) extras += '<div class="yb-pronouns">' + person.pronouns + '</div>';
        if (person.allergies) extras += '<div class="yb-allergy">' + person.allergies + '</div>';
        if (person.schedule === 'morning') extras += '<div class="yb-schedule">AM only</div>';

        html += '<button class="yb-card yb-card-class" data-idx="' + idx + '" aria-label="' + displayName + ' ' + person.family + '">' +
          '<div class="yb-photo" style="background:' + bgStyle + '"><span>' + person.name.charAt(0) + '</span></div>' +
          '<div class="yb-name">' + displayName + '</div>' +
          '<div class="yb-subtitle">Age ' + person.age + '</div>' +
          '<div class="yb-family">' + person.family + ' Family</div>' +
          extras +
          '</button>';
        shown++;
      });

    } else {
      // ---- Face grid view (Everyone / Parents Only / search) ----
      allPeople.forEach(function (person, idx) {
        if (activeFilter === 'parents' && person.type !== 'parent') return;
        if (isGroupFilter(activeFilter)) {
          if (person.type === 'parent') return;
          if (person.group !== activeFilter) return;
        }

        if (query) {
          var searchText = (person.name + ' ' + (person.lastName || person.family) + ' ' + person.family + ' ' + (person.group || '') + ' ' + person.parentNames + ' ' + (person.kidNames ? person.kidNames.join(' ') : '')).toLowerCase();
          if (searchText.indexOf(query) === -1) return;
        }

        var displayName = person.type === 'kid' && person.lastName && person.lastName !== person.family
          ? person.name + ' ' + person.lastName
          : person.name;
        var subtitle = person.type === 'kid'
          ? 'Age ' + person.age + ' &middot; ' + person.group
          : 'Parent';
        var bgStyle = faceColor(person.name);

        var pronounTag = person.pronouns ? '<div class="yb-pronouns">' + person.pronouns + '</div>' : '';

        // Show "Parent of X" when kids have different last names
        var parentOfTag = '';
        if (person.type === 'parent' && person.diffNameKids && person.diffNameKids.length > 0) {
          var dnk = person.diffNameKids;
          var label = dnk[0].name + ' ' + dnk[0].lastName;
          if (dnk.length === 2) label += ' & ' + dnk[1].name + ' ' + dnk[1].lastName;
          else if (dnk.length > 2) label += ' + ' + (dnk.length - 1) + ' more';
          parentOfTag = '<div class="yb-parent-of">Parent of ' + label + '</div>';
        }

        html += '<button class="yb-card" data-idx="' + idx + '" aria-label="' + displayName + ' ' + person.family + '">' +
          '<div class="yb-photo" style="background:' + bgStyle + '"><span>' + person.name.charAt(0) + '</span></div>' +
          '<div class="yb-name">' + displayName + '</div>' +
          '<div class="yb-subtitle">' + subtitle + '</div>' +
          pronounTag +
          '<div class="yb-family">' + person.family + ' Family</div>' +
          parentOfTag +
          '</button>';
        shown++;
      });
    }

    directoryGrid.innerHTML = html;
    if (directoryCount) {
      if (isClassView) {
        directoryCount.textContent = shown + ' students in ' + activeFilter;
      } else {
        directoryCount.textContent = shown + ' of ' + allPeople.length + ' people';
      }
    }

    // Click handlers — face cards
    directoryGrid.querySelectorAll('.yb-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-idx'), 10);
        showPersonDetail(allPeople[idx]);
      });
    });

    // Click handlers — staff banner people
    directoryGrid.querySelectorAll('[data-staff-idx]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-staff-idx'), 10);
        showPersonDetail(allPeople[idx]);
      });
    });
  }

  function showPersonDetail(person, boardInfo) {
    if (!personDetail || !personDetailCard) return;
    var fam = FAMILIES.filter(function(f){return f.name === person.family;})[0];
    if (!fam) return;

    var emailSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
    var phoneSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';

    var html = '<button class="detail-close" aria-label="Close">&times;</button>';
    html += '<div class="detail-header">';
    html += '<div class="detail-photo" style="background:' + faceColor(person.name) + '"><span>' + person.name.charAt(0) + '</span></div>';
    html += '<div class="detail-info">';
    var detailLast = person.lastName || fam.name;
    html += '<h3>' + person.name + ' ' + detailLast + '</h3>';
    if (boardInfo) {
      html += '<p class="detail-board-role">' + boardInfo.role + '</p>';
    }
    if (person.type === 'kid') {
      html += '<p class="detail-group">Age ' + person.age + ' &middot; ' + person.group + '</p>';
      if (person.pronouns) html += '<p class="detail-pronouns">' + person.pronouns + '</p>';
      if (person.schedule && person.schedule !== 'all-day') {
        html += '<p class="detail-schedule">' + (person.schedule === 'morning' ? 'Morning only' : 'Afternoon only') + '</p>';
      }
      if (person.allergies) html += '<p class="detail-allergy-info">Allergies: ' + person.allergies + '</p>';
      html += '<p class="detail-parents">Parents: ' + fam.parents + '</p>';
    } else {
      if (!boardInfo) html += '<p class="detail-group">Parent</p>';
      if (person.pronouns) html += '<p class="detail-pronouns">' + person.pronouns + '</p>';
      html += '<p class="detail-kids">Kids: ' + fam.kids.map(function(k){
        var kLast = k.lastName || fam.name;
        return k.name + (kLast !== fam.name ? ' ' + kLast : '') + ' (' + k.group + ')';
      }).join(', ') + '</p>';
    }
    html += '</div></div>';

    html += '<div class="detail-contact">';
    if (boardInfo) {
      html += '<a href="mailto:' + boardInfo.email + '" class="detail-btn detail-btn-board">';
      html += emailSvg + ' ' + boardInfo.email + ' <small>(' + boardInfo.role + ')</small></a>';
    }
    html += '<a href="mailto:' + fam.email + '" class="detail-btn detail-btn-email">';
    html += emailSvg + ' ' + fam.email + (boardInfo ? ' <small>(personal)</small>' : '') + '</a>';
    html += '<a href="tel:' + fam.phone.replace(/[^+\d]/g, '') + '" class="detail-btn detail-btn-phone">';
    html += phoneSvg + ' ' + fam.phone + '</a>';
    html += '</div>';

    // Show other family members
    html += '<div class="detail-family">';
    html += '<h4>' + fam.name + ' Family</h4>';
    html += '<div class="detail-family-grid">';
    // Parents
    fam.parents.split(' & ').forEach(function(pName) {
      html += '<div class="detail-member' + (pName.trim() === person.name ? ' detail-member-current' : '') + '">';
      html += '<div class="detail-member-dot" style="background:' + faceColor(pName.trim()) + '"><span>' + pName.trim().charAt(0) + '</span></div>';
      html += '<span>' + pName.trim() + '</span><small>Parent</small></div>';
    });
    // Kids
    fam.kids.forEach(function(kid) {
      html += '<div class="detail-member' + (kid.name === person.name ? ' detail-member-current' : '') + '">';
      html += '<div class="detail-member-dot" style="background:' + faceColor(kid.name) + '"><span>' + kid.name.charAt(0) + '</span></div>';
      html += '<span>' + kid.name + '</span><small>' + kid.group + '</small></div>';
    });
    html += '</div></div>';

    personDetailCard.innerHTML = html;
    personDetail.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Close handlers
    personDetailCard.querySelector('.detail-close').addEventListener('click', closeDetail);
    personDetail.addEventListener('click', function (e) {
      if (e.target === personDetail) closeDetail();
    });
  }

  function closeDetail() {
    if (personDetail) {
      personDetail.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  // Board-only detail (when person isn't in directory data yet)
  function showBoardOnlyDetail(fullName, boardInfo) {
    if (!personDetail || !personDetailCard) return;
    var emailSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
    var html = '<button class="detail-close" aria-label="Close">&times;</button>';
    html += '<div class="detail-header">';
    html += '<div class="detail-photo" style="background:' + faceColor(fullName) + '"><span>' + fullName.charAt(0) + '</span></div>';
    html += '<div class="detail-info">';
    html += '<h3>' + fullName + '</h3>';
    html += '<p class="detail-board-role">' + boardInfo.role + '</p>';
    html += '</div></div>';
    html += '<div class="detail-contact">';
    html += '<a href="mailto:' + boardInfo.email + '" class="detail-btn detail-btn-board">';
    html += emailSvg + ' ' + boardInfo.email + '</a>';
    html += '</div>';
    personDetailCard.innerHTML = html;
    personDetail.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    personDetailCard.querySelector('.detail-close').addEventListener('click', closeDetail);
    personDetail.addEventListener('click', function (e) {
      if (e.target === personDetail) closeDetail();
    });
  }

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDetail();
  });

  // Filter pills
  document.querySelectorAll('.filter-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      document.querySelectorAll('.filter-pill').forEach(function (p) { p.classList.remove('active'); });
      this.classList.add('active');
      activeFilter = this.getAttribute('data-filter');
      renderDirectory();
    });
  });

  // Search
  if (directorySearch) {
    directorySearch.addEventListener('input', function () {
      renderDirectory();
    });
  }

  // Initial render
  renderDirectory();

  // Board card click handlers
  document.querySelectorAll('.portal-board-card[data-board]').forEach(function (card) {
    card.style.cursor = 'pointer';
    card.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      var fullName = this.getAttribute('data-board');
      var boardRole = this.getAttribute('data-board-role');
      var boardEmail = this.getAttribute('data-board-email');
      var familyName = this.getAttribute('data-board-family');
      var boardInfo = {role: boardRole, email: boardEmail};

      // Try to find by explicit family mapping first, then by full name
      var found = null;
      if (familyName) {
        var first = fullName.split(' ')[0];
        for (var i = 0; i < allPeople.length; i++) {
          if (allPeople[i].name === first && allPeople[i].family === familyName) {
            found = {person: allPeople[i], idx: i};
            break;
          }
        }
      }
      if (!found) found = findPersonByFullName(fullName);

      if (found) {
        showPersonDetail(found.person, boardInfo);
      } else {
        // Board member not in directory yet — show basic card
        showBoardOnlyDetail(fullName, boardInfo);
      }
    });
  });

  // ──────────────────────────────────────────────
  // 8. Google Sign-In (Members Portal)
  // ──────────────────────────────────────────────
  //
  // Set this to your Google Cloud OAuth Client ID to enable Google Sign-In.
  // Leave as empty string to use password-only auth.
  //
  var GOOGLE_CLIENT_ID = ''; // e.g., '123456789.apps.googleusercontent.com'
  //
  // Optional: restrict to your Google Workspace domain
  var ALLOWED_DOMAIN = ''; // e.g., 'rootsandwingsindy.com'

  if (GOOGLE_CLIENT_ID && typeof google !== 'undefined' && google.accounts) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleSignIn,
      auto_select: false // Always show account picker
    });

    var googleBtn = document.getElementById('googleSignInBtn');
    if (googleBtn) {
      google.accounts.id.renderButton(googleBtn, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        width: 280
      });

      // Show the divider
      var divider = document.getElementById('loginDivider');
      if (divider) divider.style.display = '';
    }
  }

  function handleGoogleSignIn(response) {
    // Decode the JWT token (client-side only — not cryptographically verified)
    try {
      var payload = JSON.parse(atob(response.credential.split('.')[1]));
      var email = payload.email || '';
      var domain = email.split('@')[1] || '';

      // Check domain restriction if configured
      if (ALLOWED_DOMAIN && domain !== ALLOWED_DOMAIN) {
        var googleError = document.getElementById('googleError');
        if (googleError) googleError.style.display = 'block';
        return;
      }

      // Success — store session and show dashboard
      sessionStorage.setItem(SESSION_KEY, 'true');
      sessionStorage.setItem('rw_user_name', payload.name || '');
      sessionStorage.setItem('rw_user_email', email);
      showDashboard();
    } catch (err) {
      console.error('Google Sign-In error:', err);
    }
  }

  // ──────────────────────────────────────────────
  // 9. PWA Install Prompt
  // ──────────────────────────────────────────────
  var deferredPrompt = null;
  var installSection = document.getElementById('install-prompt');
  var installBtn = document.getElementById('installBtn');
  var dismissBtn = document.getElementById('dismissInstall');

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (installSection && !localStorage.getItem('rw_install_dismissed')) {
      installSection.style.display = '';
    }
  });

  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () {
          deferredPrompt = null;
          if (installSection) installSection.style.display = 'none';
        });
      }
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', function () {
      if (installSection) installSection.style.display = 'none';
      localStorage.setItem('rw_install_dismissed', 'true');
    });
  }

  // ──────────────────────────────────────────────
  // 10. Style Switcher
  // ──────────────────────────────────────────────
  var THEMES = [
    {
      id: 'fraunces',
      label: 'Style 1',
      font: 'Fraunces',
      logo: 'logo-mark.svg',
      watermark: 'logo-mark.png',
      swatches: ['#5B8A8D', '#3D6B6E', '#D4915E', '#7A9E7E']
    },
    {
      id: 'playfair',
      label: 'Style 2',
      font: 'Playfair Display',
      logo: 'logo-new.png',
      watermark: 'logo-new.png',
      swatches: ['#2D6A3F', '#1E4F2E', '#D4712A', '#8DB43E']
    },
    {
      id: 'style3',
      label: 'Style 3',
      font: 'Cormorant Garamond',
      logo: 'logo-style3.png',
      watermark: 'logo-style3.png',
      swatches: ['#6B4E71', '#4E3754', '#D4915E', '#B68CB5']
    }
  ];

  var THEME_KEY = 'rw_theme';

  function getThemeById(id) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) return THEMES[i];
    }
    return null;
  }

  function applyTheme(themeId) {
    var theme = getThemeById(themeId);
    if (!theme) return;

    // Set data attribute (or remove for default playfair)
    if (themeId === 'playfair') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', themeId);
    }

    // Swap logos
    document.querySelectorAll('.nav-brand img, .login-card .hero-logo img').forEach(function (img) {
      img.setAttribute('src', theme.logo);
    });
    document.querySelectorAll('.hero-watermark img').forEach(function (img) {
      img.setAttribute('src', theme.watermark);
    });

    // Update favicon
    var favicon = document.querySelector('link[rel="icon"]');
    if (favicon) favicon.setAttribute('href', theme.logo);

    // Update active state in panel
    document.querySelectorAll('.style-option').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-theme') === themeId);
    });

    // Save preference
    localStorage.setItem(THEME_KEY, themeId);
  }

  function buildSwitcher() {
    // Toggle button
    var toggle = document.createElement('button');
    toggle.className = 'style-switcher-toggle';
    toggle.setAttribute('aria-label', 'Toggle style switcher');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';

    // Panel
    var panel = document.createElement('div');
    panel.className = 'style-switcher-panel';
    panel.innerHTML = '<h4>Choose a Style</h4>';

    THEMES.forEach(function (theme) {
      var btn = document.createElement('button');
      btn.className = 'style-option';
      btn.setAttribute('data-theme', theme.id);

      var swatchesHtml = '<div class="style-option-swatches">';
      theme.swatches.forEach(function (color) {
        swatchesHtml += '<span class="style-option-swatch" style="background:' + color + '"></span>';
      });
      swatchesHtml += '</div>';

      btn.innerHTML = swatchesHtml +
        '<div><span class="style-option-label">' + theme.label +
        '</span><span class="style-option-font">' + theme.font + '</span></div>';

      btn.addEventListener('click', function () {
        applyTheme(theme.id);
      });

      panel.appendChild(btn);
    });

    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    toggle.addEventListener('click', function () {
      panel.classList.toggle('open');
    });

    // Close panel on outside click
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && !toggle.contains(e.target)) {
        panel.classList.remove('open');
      }
    });
  }

  // Apply saved theme immediately, then build the UI
  var savedTheme = localStorage.getItem(THEME_KEY) || 'playfair';
  applyTheme(savedTheme);
  buildSwitcher();

})();
