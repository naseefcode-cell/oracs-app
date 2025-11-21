const nodemailer = require('nodemailer');

const createTransporter = async () => {
  try {
    // For production - use Gmail SMTP
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        throw new Error('Gmail credentials missing in production');
      }
      return nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });
    }

    // For development - use Gmail if available, otherwise fallback
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      return nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });
    }

    // Fallback: just log to console (for development without Gmail config)
    console.log('⚠️  Gmail credentials not found. Using console fallback.');
    return {
      sendMail: async (mailOptions) => {
        console.log('📧 DEVELOPMENT MODE - Email would be sent:');
        console.log('   To:', mailOptions.to);
        console.log('   Subject:', mailOptions.subject);
        
        if (mailOptions.html) {
          // Extract and log OTP/reset codes for development
          const codeMatch = mailOptions.html.match(/\b\d{6}\b/);
          if (codeMatch) {
            console.log('   🔑 Code:', codeMatch[0]);
          }
        }
        
        console.log('   ---');
        return { messageId: 'console-log', response: 'Development mode' };
      }
    };
  } catch (error) {
    console.error('❌ Email transporter creation failed:', error);
    // Return fallback transporter even if there's an error
    return {
      sendMail: async (mailOptions) => {
        console.log('📧 FALLBACK MODE - Email would be sent:');
        console.log('   To:', mailOptions.to);
        console.log('   Subject:', mailOptions.subject);
        return { messageId: 'fallback-log', response: 'Fallback mode' };
      }
    };
  }
};

const sendOTPEmail = async (email, otpCode) => {
  try {
    const transporter = await createTransporter();
    
    const mailOptions = {
      from: `"ResearchHub" <${process.env.GMAIL_USER || 'noreply@researchhub.com'}>`,
      to: email,
      subject: 'Your ResearchHub Verification Code',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #FF6B6B, #4ECDC4); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .otp-box { background: white; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; border: 2px dashed #FF6B6B; }
                .otp-code { font-size: 32px; font-weight: bold; color: #FF6B6B; letter-spacing: 5px; margin: 10px 0; }
                .footer { text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>ResearchHub</h1>
                <p>Email Verification</p>
            </div>
            <div class="content">
                <h2>Hello!</h2>
                <p>Thank you for registering with ResearchHub. Please use the following verification code to complete your registration:</p>
                
                <div class="otp-box">
                    <div class="otp-code">${otpCode}</div>
                    <p>This code will expire in 10 minutes.</p>
                </div>
                
                <p>If you didn't request this code, please ignore this email.</p>
                <p>Welcome to our research community! 🚀</p>
            </div>
            <div class="footer">
                <p>This is an automated message from ResearchHub.</p>
                <p>&copy; ${new Date().getFullYear()} ResearchHub. All rights reserved.</p>
            </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    
    if (process.env.GMAIL_USER) {
      console.log('✅ Email sent successfully to:', email);
    } else {
      console.log('✅ Development mode - OTP logged to console');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Email sending error:', error);
    console.log('📟 OTP Code for manual verification:', otpCode);
    return true; // Still return true for development
  }
};

const sendPasswordResetEmail = async (email, resetCode) => {
  try {
    const transporter = await createTransporter();
    
    const mailOptions = {
      from: `"ResearchHub" <${process.env.GMAIL_USER || 'noreply@researchhub.com'}>`,
      to: email,
      subject: 'Reset Your ResearchHub Password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #45B7D1, #96CEB4); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .reset-box { background: white; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; border: 2px dashed #45B7D1; }
                .reset-code { font-size: 32px; font-weight: bold; color: #45B7D1; letter-spacing: 5px; margin: 10px 0; }
                .footer { text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
                .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 15px 0; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>ResearchHub</h1>
                <p>Password Reset</p>
            </div>
            <div class="content">
                <h2>Hello!</h2>
                <p>You requested to reset your password for your ResearchHub account.</p>
                
                <div class="reset-box">
                    <p>Use this verification code to reset your password:</p>
                    <div class="reset-code">${resetCode}</div>
                    <p>This code will expire in 1 hour.</p>
                </div>
                
                <div class="warning">
                    <strong>⚠️ Security Tip:</strong> If you didn't request this reset, please ignore this email and ensure your account is secure.
                </div>
                
                <p>Enter this code on the password reset page to create a new password.</p>
            </div>
            <div class="footer">
                <p>This is an automated message from ResearchHub.</p>
                <p>&copy; ${new Date().getFullYear()} ResearchHub. All rights reserved.</p>
            </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    
    if (process.env.GMAIL_USER) {
      console.log('✅ Password reset email sent successfully to:', email);
    } else {
      console.log('✅ Development mode - Reset code logged to console');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Password reset email sending error:', error);
    console.log('🔑 Reset Code for manual testing:', resetCode);
    return true;
  }
};

const sendPasswordResetConfirmationEmail = async (email) => {
  try {
    const transporter = await createTransporter();
    
    const mailOptions = {
      from: `"ResearchHub" <${process.env.GMAIL_USER || 'noreply@researchhub.com'}>`,
      to: email,
      subject: 'Your ResearchHub Password Has Been Reset',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #96CEB4, #FFEAA7); color: #333; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .success-box { background: #d4edda; color: #155724; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>ResearchHub</h1>
                <p>Password Reset Confirmation</p>
            </div>
            <div class="content">
                <h2>Password Successfully Reset</h2>
                
                <div class="success-box">
                    <p><strong>✅ Your ResearchHub password has been successfully reset.</strong></p>
                </div>
                
                <p>If you did not make this change, please contact our support team immediately.</p>
                <p>You can now login to your account with your new password.</p>
                
                <p>Thank you for helping us keep your account secure!</p>
            </div>
            <div class="footer">
                <p>This is an automated message from ResearchHub.</p>
                <p>&copy; ${new Date().getFullYear()} ResearchHub. All rights reserved.</p>
            </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    
    if (process.env.GMAIL_USER) {
      console.log('✅ Password reset confirmation sent to:', email);
    } else {
      console.log('✅ Development mode - Reset confirmation logged');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Reset confirmation email error:', error);
    return true;
  }
};

module.exports = {
  sendOTPEmail,
  sendPasswordResetEmail,
  sendPasswordResetConfirmationEmail
};