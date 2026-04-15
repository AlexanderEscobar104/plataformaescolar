document.addEventListener("DOMContentLoaded", () => {
  // Initialize EmailJS con tu Public Key
  // Reemplaza "TU_PUBLIC_KEY" con tu clave real de EmailJS
  if (typeof emailjs !== "undefined") {
    emailjs.init({
      publicKey: "oBklDnjtPUW0AM5nN",
    });
  }
  // Sticky Header
  const header = document.querySelector('.glass-nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });

  // Mobile Menu Toggle (Simplified)
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');
  
  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
      navLinks.style.flexDirection = 'column';
      navLinks.style.position = 'absolute';
      navLinks.style.top = '60px';
      navLinks.style.left = '0';
      navLinks.style.width = '100%';
      navLinks.style.background = 'rgba(255, 255, 255, 0.95)';
      navLinks.style.padding = '20px';
      navLinks.style.borderRadius = '16px';
      navLinks.style.gap = '20px';
      navLinks.style.border = '1px solid var(--surface-border)';
    });
  }

  // Toast Functionality & Form Submission
  const demoButton = document.getElementById("demoButton");
  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMessage");
  const schoolName = document.getElementById("schoolName");
  const schoolEmail = document.getElementById("schoolEmail");
  const schoolPhone = document.getElementById("schoolPhone");
  const studentCount = document.getElementById("studentCount");

  if (demoButton && toast) {
    demoButton.addEventListener("click", () => {
      // Basic validation
      if (!schoolName.value.trim() || !schoolEmail.value.trim() || !schoolPhone.value.trim() || !studentCount.value) {
        toastMsg.innerText = "Por favor, completa todos los campos para continuar.";
        toast.classList.add("is-visible");
        setTimeout(() => toast.classList.remove("is-visible"), 4000);
        return;
      }

      const originalBtnText = demoButton.innerHTML;
      demoButton.innerHTML = '<span>Enviando...</span>';
      demoButton.style.opacity = '0.7';
      demoButton.style.pointerEvents = 'none';

      // Variables de EmailJS (Reemplaza con tus IDs reales)
      const serviceID = "service_jhlfb79";
      const templateID = "template_h8sffm7";

      const templateParams = {
        schoolName: schoolName.value,
        schoolEmail: schoolEmail.value,
        schoolPhone: schoolPhone.value,
        studentCount: studentCount.value,
        reply_to: schoolEmail.value // Importante para que EmailJS pueda hacer el Auto-Reply a este correo
      };

      if (typeof emailjs !== 'undefined') {
        emailjs.send(serviceID, templateID, templateParams)
          .then(() => {
            // Clear form
            schoolName.value = '';
            schoolEmail.value = '';
            schoolPhone.value = '';
            studentCount.value = '';
      
            // Show success toast
            toastMsg.innerText = "¡Gracias! Hemos recibido tu solicitud. Te contactaremos pronto.";
            toast.classList.add("is-visible");
            
            setTimeout(() => {
              toast.classList.remove("is-visible");
            }, 5000);
          })
          .catch((err) => {
            console.error("Error al enviar email:", err);
            toastMsg.innerText = "Hubo un error al enviar tu solicitud. Verifica tu conexión e inténtalo de nuevo.";
            toast.classList.add("is-visible");
            setTimeout(() => {
              toast.classList.remove("is-visible");
            }, 5000);
          })
          .finally(() => {
            demoButton.innerHTML = originalBtnText;
            demoButton.style.opacity = '1';
            demoButton.style.pointerEvents = 'auto';
          });
      } else {
        console.error("EmailJS no está cargado correctamente.");
        demoButton.innerHTML = originalBtnText;
        demoButton.style.opacity = '1';
        demoButton.style.pointerEvents = 'auto';
      }
    });
  }

  // Intersection Observer for Scroll Animations
  const scrollElements = document.querySelectorAll('.scroll-reveal');
  
  const elementInView = (el, dividend = 1) => {
    const elementTop = el.getBoundingClientRect().top;
    return (elementTop <= (window.innerHeight || document.documentElement.clientHeight) / dividend);
  };

  const displayScrollElement = (element) => {
    element.classList.add('is-revealed');
  };

  const setScrollObserve = () => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          displayScrollElement(entry.target);
          // Optional: observer.unobserve(entry.target) if you only want it to animate once
          observer.unobserve(entry.target);
        }
      });
    }, {
      rootMargin: "0px 0px -50px 0px",
      threshold: 0.15
    });

    scrollElements.forEach(el => observer.observe(el));
  };

  // Check immediately and set up observer
  setScrollObserve();

  // Handle smooth scroll offset for fixed header
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        const headerOffset = 100;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
  
        window.scrollTo({
           top: offsetPosition,
           behavior: "smooth"
        });
        
        // Hide mobile menu if open
        if (window.innerWidth <= 768 && navLinks.style.display === 'flex') {
           navLinks.style.display = 'none';
        }
      }
    });
  });

  // FAQ Accordion Logic
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const btn = item.querySelector('.faq-question');
    if (btn) {
      btn.addEventListener('click', () => {
        const isActive = item.classList.contains('active');
        // Cerrar los demás
        faqItems.forEach(otherItem => otherItem.classList.remove('active'));
        // Alternar el actual
        if (!isActive) {
          item.classList.add('active');
        }
      });
    }
  });

});
