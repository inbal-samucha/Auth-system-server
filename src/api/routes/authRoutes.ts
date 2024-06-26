import { Op } from 'sequelize';
import { JwtPayload } from 'jsonwebtoken';
import express, { Request, Response } from 'express';

import { User } from '../../db/models/User';

import Forbidden from '../../errors/Forbidden';
import sendMail from '../../utils/EmailProvider';
import Unauthorized from '../../errors/Unauthorized';
import { SignTokens, verifyJwt } from '../../utils/jwt';
import BadRequestError from '../../errors/BadRequestError';
import { cookiesOptions, getExpiresIn } from '../../utils/cookieOptions';



const authRoutes = express.Router();

authRoutes.post('/register', async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body;

  if(!email || !password || !firstName || !lastName) {
    throw new BadRequestError({code: 400, message: "email, password, first name and last name is required!", logging: true});
  }

  const exsistUser = await User.findOne({ where: { email }});

  if(exsistUser){
    throw new BadRequestError({code: 400, message: "User is already exsist", logging: true});
  }

  const user = await User.create({ email, password, firstName, lastName });
  
  await sendMail(user.email, 'Welcome to auth system!', 'welcome', { userName: user.fullName });

  const { access_token, refresh_token } = await SignTokens(user);

  const { ACCESS_TOKEN_EXPIRES_IN, REFRESH_TOKEN_EXPIRES_IN } = await getExpiresIn();

  res.cookie('access_token', access_token, {
    ...cookiesOptions, 
    expires: new Date(Date.now() + parseInt(ACCESS_TOKEN_EXPIRES_IN!) * 60 * 1000)
  })
  res.cookie('refresh_token', refresh_token, {
    ...cookiesOptions,
    expires: new Date(Date.now() + parseInt(REFRESH_TOKEN_EXPIRES_IN!) * 60 * 1000)
  });

  res.send(user);
});



authRoutes.post('/login', async (req: Request, res: Response) => {
  const cookies = req.cookies;
  console.log(`cookie available at login: ${JSON.stringify(cookies)}`);

  const { email, password } = req.body;

  const user = await User.findOne( { where: { email }});

  if(!user || !(await User.comparePasswords(password, user.password))){
    throw new BadRequestError({code: 400, message: "Invalid email or password", logging: true});
  }


  const { access_token, refresh_token } = await SignTokens(user);

  // const { ACCESS_TOKEN_EXPIRES_IN, REFRESH_TOKEN_EXPIRES_IN } = await getExpiresIn();

  // Initialize the new refresh token array
  let newRefreshTokenArray: string[] = [];

  if(user.refreshToken){
    if(cookies?.refresh_token){
      newRefreshTokenArray = user.refreshToken.filter(rt => rt !== cookies.refresh_token)
    }else{
      newRefreshTokenArray = user.refreshToken;
    }
  }
  console.log('new refresh token: ', newRefreshTokenArray);
  

if (cookies?.refresh_token) {

  /* 
  Scenario added here: 
      1) User logs in but never uses RT and does not logout 
      2) RT is stolen
      3) If 1 & 2, reuse detection is needed to clear all RTs when user logs in
  */
  const refreshToken = cookies.refresh_token;
  const foundToken = await User.findOne({ where: { refreshToken: { [Op.contains]: [refreshToken]} }});

  // Detected refresh token reuse!
  if (!foundToken) {
      console.log('attempted refresh token reuse at login!')
      // clear out ALL previous refresh tokens
      newRefreshTokenArray = [];
  }

  res.clearCookie('refresh_token', { httpOnly: true, sameSite: 'none', secure: true });
  res.clearCookie('access_token', { httpOnly: true, sameSite: 'none', secure: true });
}

// Saving refreshToken with current user
user.refreshToken = [...newRefreshTokenArray, refresh_token];
const result = await user.save();
console.log(result);

// Creates Secure Cookie with refresh token
  
  res.cookie('access_token', access_token, {
    ...cookiesOptions, 
    maxAge: 24 * 60 * 60 * 1000
    // expires: new Date(Date.now() + parseInt(ACCESS_TOKEN_EXPIRES_IN!) * 60 * 1000)
  })
  res.cookie('refresh_token', refresh_token, {
    ...cookiesOptions,
    maxAge: 24 * 60 * 60 * 1000 
  });
 
  res.send({success: 'success '})
});





authRoutes.get('/refresh_token', async (req: Request, res: Response) => {
  //if !cookie.refresh_token return 401 unauthorized
  const cookies = req.cookies;
  if(!cookies?.refresh_token){
    throw new Unauthorized({code: 401, message: "token is expired please login again", logging: true});
  }

  //save refresh token in variable and clear the cookie.refresh_token
  const refreshToken = cookies.refresh_token;
  res.clearCookie('refresh_token', { httpOnly: true, sameSite: 'none', secure: true });
  res.clearCookie('access_token', { httpOnly: true, sameSite: 'none', secure: true });

  const foundUser = await User.findOne({ where: { refreshToken: { [Op.contains]: [refreshToken]} }});

  //detected refresh token reuse
  if(!foundUser){

    try{
      const decodedToken: string | JwtPayload = await verifyJwt(refreshToken, 'refreshTokenPublicKey');
      console.log('attempted refresh token reuse!');

      const hackedUser = await User.findByPk(Number((decodedToken as JwtPayload)?.sub));

      if (hackedUser) {
        hackedUser.refreshToken = [];
        const result = await hackedUser.save();
        console.log(result);
      }

    throw new Forbidden({code: 403, message: "Forbidden", logging: true});

    }catch (err){
      throw new Forbidden({code: 403, message: "Forbidden", logging: true});
    }

  }

  const newRefreshTokenArray = (foundUser.refreshToken || []).filter(rt => rt !== refreshToken);

  //evaluate jwt 
  //check if refresh token is valid, if it is create new refresh and access tokens

  try{
    const decodedToken: string | JwtPayload = await verifyJwt(refreshToken, 'refreshTokenPublicKey');

    if (foundUser.id !== Number((decodedToken as JwtPayload)?.sub)) return res.sendStatus(403);

    const { access_token, refresh_token } = await SignTokens(foundUser);

    // Saving refreshToken with current user
    foundUser.refreshToken = [...newRefreshTokenArray, refresh_token];
    await foundUser.save()

    // Creates Secure Cookie with refresh token
    res.cookie('access_token', access_token, { 
      ...cookiesOptions, 
      maxAge: 24 * 60 * 60 * 1000
    });

    res.cookie('refresh_token', refresh_token, {
      ...cookiesOptions,
      maxAge: 24 * 60 * 60 * 1000 
    });


    res.json({ access_token, refresh_token });

  } catch (err){
    console.log('expired refresh token')
    foundUser.refreshToken = [...newRefreshTokenArray];
    const result = await foundUser.save();
    console.log(result);

    throw new Forbidden({code: 403, message: "Forbidden", logging: true});
  }

});

authRoutes.get('/logout', async (req: Request, res: Response) => {
  const cookie = req.cookies;
  if(!cookie?.refresh_token) return res.sendStatus(404);

  const refreshToken = cookie.refresh_token;

  //Is refresh token in db?
  const foundUser = await User.findOne({ where: { refreshToken: { [Op.contains]: [refreshToken]} }});
  if(!foundUser){
    res.clearCookie('refresh_token', { httpOnly: true, sameSite: 'none', secure: true });
    res.clearCookie('access_token', { httpOnly: true, sameSite: 'none', secure: true });
    return res.sendStatus(204);
  }

      // Delete refreshToken in db
    foundUser.refreshToken = (foundUser.refreshToken || []).filter(rt => rt !== refreshToken);;
    const result = await foundUser.save();
    console.log(result);

    res.clearCookie('refresh_token', { httpOnly: true, sameSite: 'none', secure: true });
    res.clearCookie('access_token', { httpOnly: true, sameSite: 'none', secure: true });
    res.sendStatus(204);
});

export { authRoutes };






