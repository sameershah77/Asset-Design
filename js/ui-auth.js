// ui-auth.js - client-only login/signup behavior
(function(){
  function $(id){return document.getElementById(id)}

  const API_BASE = 'https://localhost:7186/api/Auth';

  function showToast(msg){
    let t = document.querySelector('.toast');
    if(!t){
      t = document.createElement('div');
      t.className = 'toast';
      Object.assign(t.style,{position:'fixed',right:'20px',top:'20px',padding:'10px 14px',background:'#111827',color:'#fff',borderRadius:'8px',boxShadow:'0 6px 18px rgba(2,6,23,.3)',zIndex:9999});
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    setTimeout(()=>{ t.style.transition = 'opacity 400ms'; t.style.opacity = '0'; }, 1800);
  }

  // toggle password helper
  function setupToggle(buttonId, inputId){
    const btn = $(buttonId);
    const input = btn ? btn.previousElementSibling : null;
    if(!btn || !input) return;
    btn.addEventListener('click', ()=>{
      const shown = input.type === 'text';
      input.type = shown ? 'password' : 'text';
      btn.textContent = shown ? 'Show' : 'Hide';
      btn.setAttribute('aria-pressed', String(!shown));
    });
  }

  // Signup form
  const signupForm = $('signupForm');
  if(signupForm){
    setupToggle('togglePw','password');
    signupForm.addEventListener('submit', async function(e){
      e.preventDefault();
      clearErrors(signupForm);
      const name = signupForm.name.value.trim();
      const role = signupForm.role ? signupForm.role.value : 'User';
      const email = signupForm.email.value.trim();
      const pw = signupForm.password.value;
      let ok = true;
      if(!name){ setError(signupForm.name, 'Name is required'); ok=false; }
      if(!validateEmail(email)){ setError(signupForm.email, 'Please enter a valid email'); ok=false; }
      if(pw.length < 6){ setError(signupForm.password, 'Password must be at least 6 characters'); ok=false; }
      if(!ok){ return; }
      const status = $('status');
      status.textContent = 'Creating account...';
      try{
        const resp = await fetch(API_BASE + '/register', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ userName: name, email: email, password: pw, role: role}),
          credentials: 'include'
        });
        const data = await resp.json().catch(()=>null);
        console.log('Register response:', resp.status, data);
        if(!resp.ok){
          // try show server message
          const errMsg = (data && (data.message || data.error || data)) || `Register failed (${resp.status})`;
          status.textContent = String(errMsg);
          return;
        }
        // Store user information
        const userData = {
          email: email,
          name: name,
          role: role,
          registeredOn: new Date().toISOString()
        };
        localStorage.setItem('userData', JSON.stringify(userData));
        
        status.textContent = 'Account created — redirecting to login';
        showToast('Registered successfully');
        setTimeout(()=> location.href = 'login.html', 900);
      }catch(err){
        console.error('Register error', err);
        status.textContent = 'Network or server error';
      }
    });
  }

  // Login form
  const loginForm = $('loginForm');
  if(loginForm){
    setupToggle('togglePwLogin','login-password');
    loginForm.addEventListener('submit', async function(e){
      e.preventDefault();
      clearErrors(loginForm);
      const email = loginForm.email.value.trim();
      const pw = loginForm.password.value;
      let ok = true;
      if(!validateEmail(email)){ setError(loginForm.email, 'Please enter a valid email'); ok=false; }
      if(!pw){ setError(loginForm.password, 'Password is required'); ok=false; }
      if(!ok) return;
      const status = $('status');
      status.textContent = 'Signing in...';
      try{
        const resp = await fetch(API_BASE + '/login', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ email: email, password: pw }),
          credentials: 'include'
        });
        const data = await resp.json().catch(()=>null);
        console.log('Login response:', resp.status, data);
        if(!resp.ok){
          const errMsg = (data && (data.message || data.error || data)) || `Login failed (${resp.status})`;
          status.textContent = String(errMsg);
          return;
        }
        // if token returned in body, store non-HttpOnly token if present
        const token = data?.tokenResponse?.accessToken || data?.accessToken || null;
        if(token) localStorage.setItem('accessToken', token);
        
        // Store user information
        const userData = {
          email: email,
          name: data?.name || data?.userName || email.split('@')[0],
          role: data?.user?.role || 'User',
          lastLogin: new Date().toISOString()
        };
        localStorage.setItem('userData', JSON.stringify(userData));
        
        showToast('Login successful');
        status.textContent = 'Signed in — redirecting';
        setTimeout(() => {
         window.location.href = 'dashboard.html';
        }, 700);
      }catch(err){
        console.error('Login error', err);
        status.textContent = 'Network or server error';
      }
    });
  }

  function validateEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  function setError(input, msg){
    const fld = input.closest('.field');
    const err = fld && fld.querySelector('.error');
    if(err) err.textContent = msg;
  }
  function clearErrors(form){
    form.querySelectorAll('.error').forEach(el=>el.textContent='');
  }

})();
