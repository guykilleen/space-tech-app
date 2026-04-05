import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LoginPage from '../pages/LoginPage';

jest.mock('../context/AuthContext');
jest.mock('../utils/api', () => ({ post: jest.fn() }));

const mockLogin = jest.fn();

function renderLoginPage() {
  return render(
    <BrowserRouter>
      <LoginPage />
    </BrowserRouter>
  );
}

const emailInput    = () => document.querySelector('input[type="email"]');
const passwordInput = () => document.querySelector('input[type="password"]');

describe('LoginPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue({ login: mockLogin });
  });

  it('renders email and password fields', () => {
    renderLoginPage();
    expect(emailInput()).toBeInTheDocument();
    expect(passwordInput()).toBeInTheDocument();
  });

  it('renders a sign in button', () => {
    renderLoginPage();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('calls login with email and password on submit', async () => {
    mockLogin.mockResolvedValueOnce();
    renderLoginPage();

    fireEvent.change(emailInput(),    { target: { value: 'user@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'pass123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('user@test.com', 'pass123');
    });
  });

  it('calls login and handles rejection on invalid credentials', async () => {
    mockLogin.mockRejectedValueOnce({
      response: { data: { error: 'Invalid credentials' } },
    });
    renderLoginPage();

    fireEvent.change(emailInput(),    { target: { value: 'bad@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('bad@test.com', 'wrongpass');
    });
  });
});
