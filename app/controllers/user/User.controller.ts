import { getConnection, getCustomRepository } from 'typeorm';
import { Request, Response } from 'express';
import * as _ from 'lodash';

import GameApplication from '../../models/GameApplication';
import UserProfile from '../../models/UserProfile';
import UserStats from '../../models/UserStats';
import Activity from '../../models/Activity';

import LeaderboardRepository from '../../repository/leaderboard.repository';
import UserRepository from '../../repository/User.repository';
import { IUserRequest } from '../../request/IRequest';
import { DATABASE_MAX_ID } from '../../constants';
import ApiError from '../../utils/apiError';
import { hash } from '../../utils/hash';

import { parseBooleanWithDefault, parseIntWithDefault } from '../../../test/helpers';

import EmailVerification from '../../models/EmailVerification';
import LinkedAccount from '../../models/LinkedAccount';
import PasswordReset from '../../models/PasswordReset';
import UserGameStats from '../../models/UserGameStats';
import EmailOptIn from '../../models/EmailOptIn';
import User, { UserRole } from '../../models/User';
import Game from '../../models/Game';

interface IUpdateUserRequest {
    lastSigned: Date;
    email: string;
    username: string;
    password: string;
    role: UserRole;
    token: string;
}

/**
 * @api {get} /lookup?username=:username&limit=:limit Looks up users by username (like match).
 * @apiName LookupUsersByUsername
 * @apiGroup User
 *
 * @apiParam {string} username  A partial or full username for a given user.
 * @apiParam {number} limit     The maximum amount of users to return (max 50)
 * @apiParam {boolean} full     If all the user details should be returned or not.
 *
 * @apiSuccess {User[]} Users    A array of user objects containing the username and id.
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     [{
 *        "username": "Sadie_Brekke21",
 *        "id": 27
 *      },
 *      {
 *        "username": "Aubrey.Watsica15",
 *        "id": 59
 *      },
 *      {
 *        "username": "Alessia.Breitenberg",
 *        "id": 83
 *      }]
 */
export async function lookupUser(request: IUserRequest, response: Response) {
    let { username, limit, full } = request.query;

    if (_.isNil(username)) username = '';
    username = username.replace(/\s/g, '').trim();

    limit = parseIntWithDefault(limit, 50, 1, 50);
    full = parseBooleanWithDefault(full, false);

    if (username === '') {
        throw new ApiError({
            error: 'The specified username within the query must not be empty.',
            code: 400,
        });
    }

    const userRepository = getCustomRepository(UserRepository);
    const users = await userRepository.getUsersLikeUsername(username, limit, ['connections']);

    _.forEach(users, (user: any) => {
        user.connections = _.map(user.connections, (a) => {
            return { username: a.username, provider: a.provider.toLowerCase() };
        });
    });

    // If the user has specified full user details, then return out early
    // before performing a filter to username and ids.
    if (full) return response.json(users);

    // Reduce the response down to the given username and id of the users.
    return response.json(
        users.map((e: User) => {
            return { username: e.username, id: e.id };
        }),
    );
}

/**
 * @api {get} /:user Request User basic information
 * @apiName GetUserById
 * @apiGroup User
 *
 * @apiParam {Number} user Users unique ID.
 *
 * @apiSuccess {string} username    The username of the User.
 * @apiSuccess {string} role        The role of the User.
 * @apiSuccess {number} id          The id of the User.
 * @apiSuccess {string} avatarUrl   The avatar url of the User.
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *      "username": "test-admin",
 *      "role": "ADMIN",
 *      "id": 1,
 *      "avatarUrl": "http://lorempixel.com/640/480/nature"
 *    }
 */
export async function show(request: IUserRequest, response: Response) {
    const sanitizedUser = request.boundUser.sanitize('email', 'lastSignIn', 'createdAt', 'updatedAt');
    return response.json(sanitizedUser);
}

/**
 * @api {get} /:user Request All User basic information
 * @apiName GetUsers
 * @apiGroup User
 * @apiPermission moderator
 *
 * @apiParam {string} limit The number of users to gather from the offset. (limit: 100)
 * @apiParam {string} offset The offset of which place to start gathering users from.
 *
 * @apiSuccess {json} Users The users within the limit and offset.
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 * {
 *   "data": [
 *     {
 *       "username": "tehstun",
 *       "email": "example@gmail.com",
 *       "role": "MODERATOR",
 *       "id": 1354,
 *       "updatedAt": "2020-01-26T00:30:11.052Z",
 *       "createdAt": "2019-02-02T17:17:09.000Z",
 *       "lastSignIn": "2020-01-26T00:30:11.050Z",
 *       "avatarUrl": null,
 *       "connections": [
 *         {
 *           "username": "tehstun",
 *           "provider": "discord"
 *         },
 *         {
 *           "username": "mambadev",
 *           "provider": "twitch"
 *         }
 *       ]
 *     }
 *   ],
 *   "pagination": {
 *     "before": null,
 *     "after": "http://localhost:8080/users/?first=1&after=1"
 *   }
 * }
 *
 */
export async function all(request: Request, response: Response) {
    const { first, after } = request.query;

    const params = {
        first: parseIntWithDefault(first, 20, 1, 100),
        after: parseIntWithDefault(after, 0, 0, DATABASE_MAX_ID),
    };

    const userRepository = getCustomRepository(UserRepository);
    const users: any = await userRepository.findUsersWithPaging({
        first: params.first,
        after: params.after,
        orderBy: 'updatedAt',
        relations: ['connections'],
    });

    const url = `${request.protocol}://${request.get('host')}${request.baseUrl}${request.path}`;

    const pagination = {
        before: `${url}?first=${params.first}&after=${_.clamp(params.after - params.first, 0, params.after)}`,
        after: `${url}?first=${params.first}&after=${params.after + params.first}`,
    };

    if (users.length === 0) pagination.after = null;
    if (params.after === 0) pagination.before = null;

    return response.json({
        data: users,
        pagination,
    });
}

/**
 * @api {post} /:user Updates User basic information
 * @apiName UpdateUserById
 * @apiGroup User
 * @apiPermission moderator, owner
 *
 * @apiParam {Number} user Users unique ID.
 * @apiParam {string} [username] Users updated username.
 * @apiParam {string} [email] Users updated email.
 * @apiParam {string} [password] Users updated password.
 * @apiParam {string} [role] Users updated role.
 * @apiParam {string} [token] Users updated token.
 * @apiParam {string} [lastSigned] Users updated last signed in date.
 *
 * @apiParamExample {json} Request-Example:
 *     {
 *      "username": "test-admin",
 *      "email": "test-admin@example.com",
 *      "password": "password",
 *      "token": "token",
 *      "role": "ADMIN",
 *      "lastSigned": "2019-11-20T15:51:24.690Z",
 *     }
 *
 * @apiSuccess {string} username    the username of the User.
 * @apiSuccess {string} role        the role of the User.
 * @apiSuccess {number} id          the id of the User.
 * @apiSuccess {string} avatarUrl   the avatar url of the User.
 * @apiSuccess {datetime} updatedAt the time the user was last updated.
 * @apiSuccess {datetime} createdAt the time the user was created at.
 * @apiSuccess {datetime} lastSignIn the time the user last signed in.
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *      "username": "test-admin",
 *      "email": "test-admin@example.com",
 *      "role": "ADMIN",
 *      "id": 1,
 *      "avatarUrl": "http://lorempixel.com/640/480/nature"
 *      "updatedAt": "2019-11-19T14:54:09.441Z",
 *      "createdAt": "2019-11-19T14:54:09.441Z",
 *      "lastSignIn": "2019-11-19T14:54:09.442Z",
 *     }
 */
export async function update(request: IUserRequest, response: Response) {
    const params = request.body as IUpdateUserRequest;

    const userRepository = getCustomRepository(UserRepository);
    const existingUsername = await userRepository.findByUsername(params.username);

    if (!_.isNil(existingUsername) && existingUsername.id !== request.boundUser.id) {
        throw new ApiError({
            error: 'The provided username already exists for a registered user.',
            code: 409,
        });
    }

    // Ensure to encrypt the updated password if it has been specified.
    if (!_.isNil(params.password)) params.password = await hash(params.password);

    Object.assign(request.boundUser, params);
    await request.boundUser.save();

    return response.json(request.boundUser);
}

/**
 * @api {delete} /:user Deletes the user from the system
 * @apiName DeleteUserById
 * @apiGroup User
 * @apiPermission admin, owner
 *
 * @apiParam {Number} user Users unique ID.
 * @apiParam {string} [lastSigned] Users updated last signed in date.
 */
export async function deleteUser(request: IUserRequest, response: Response) {
    const { boundUser: removingUser } = request;
    const { id: removingUserId } = removingUser;

    if (removingUser.role <= UserRole.MODERATOR) {
        const removalError = 'Users with roles moderator or higher cannot be deleted, ensure to demote the user first.';
        throw new ApiError({ code: 400, error: removalError });
    }

    await getConnection().transaction(async (transaction) => {
        const whereOptions = { where: { user: removingUser } };

        // First remove all related activities for the given user. Since the user is being removed, any
        // action taken by the user is only related to a given user and should be removed (not replaced
        // by competitor).
        const activities = await transaction.find(Activity, whereOptions);
        await transaction.remove(activities);

        // Remove the given users related profile && users stats
        const profiles = await transaction.find(UserProfile, whereOptions);
        await transaction.remove(profiles);

        // remove the given users related email permissions
        const emailPermissions = await transaction.find(EmailOptIn, whereOptions);
        await transaction.remove(emailPermissions);

        const statistics = await transaction.find(UserStats, whereOptions);
        await transaction.remove(statistics);

        const gameStatistics = await transaction.find(UserGameStats, whereOptions);
        await transaction.remove(gameStatistics);

        // remove the given users related accounts
        const linkedAccounts = await transaction.find(LinkedAccount, whereOptions);
        await transaction.remove(linkedAccounts);

        // remove the given users password resets
        const passwordResets = await transaction.find(PasswordReset, whereOptions);
        await transaction.remove(passwordResets);

        // remove the given users email verification
        const emailVerifications = await transaction.find(EmailVerification, whereOptions);
        await transaction.remove(emailVerifications);

        // they are purged from the players and editors body.
        const gameApplications = await transaction.find(GameApplication, whereOptions);
        await transaction.remove(gameApplications);

        const userRelatedGames = await transaction
            .getRepository(Game)
            .createQueryBuilder('games')
            .select()
            .where('(storage ->> \'players\')::json ->:id IS NOT NULL', { id: removingUserId })
            .getMany();

        for (const game of userRelatedGames) {
            const gameStorage = game?.storage;

            // Update the inner game players model to replace the removing user with the replacement
            // user. Since these will be rendered on the home page.
            if (!_.isNil(gameStorage?.players) && !_.isNil(gameStorage.players[removingUserId])) {
                const player = gameStorage.players[removingUserId];

                // Set the internal id of the player is 0, since the front end will process based on
                // the internal Id of 0, if we change the actual key id, then it does not support
                // multiple deleted users.
                gameStorage.players[removingUserId] = { id: 0, team: player.team, username: 'Competitor' };
                await transaction.save(game);
            }
        }

        // Finally delete the user.
        await transaction.remove(removingUser);
    });

    return response.json({ user: removingUserId });
}

/**
 * @api {get} /users/leaderboards Get the current win based leaderboards for all users.
 * @apiDescription Gathers the current win leaderboard statistics for all users in a paging fashion.
 * @apiName GetLeaderboardsForUser
 * @apiGroup User
 *
 * @apiParam {number} first How many users to be returned, default 20, min: 1, max: 100
 * @apiParam {number} after A offset at which point to start gathering users, default: 0, min: 0
 *
 * @apiSuccessExample Success-Response /users/leaderboards?first=5&after=40:
 *     HTTP/1.1 200 OK
 * {
 *     "data": [
 *       {
 *         "userId": 46,
 *         "username": "Sigurd.Harber",
 *         "wins": 5,
 *         "loses": 17,
 *         "xp": 15039,
 *         "coins": 18316,
 *         "level": 3
 *       },
 *       {
 *         "userId": 42,
 *         "username": "Carolyne_McClure85",
 *         "wins": 5,
 *         "loses": 13,
 *         "xp": 13695,
 *         "coins": 1888,
 *         "level": 2
 *       },
 *     ],
 *     "pagination": {
 *       "before": "http://localhost:8080/users/leaderboards?first=5&after=35",
 *       "after": "http://localhost:8080/users/leaderboards?first=5&after=45"
 *     }
 *   }
 */
export async function getUsersLeaderboards(request: Request, response: Response) {
    const { first, after } = request.query;

    const params = {
        first: parseIntWithDefault(first, 20, 1, 100),
        after: parseIntWithDefault(after, 0, 0, DATABASE_MAX_ID),
    };

    const leaderboardRepository = getCustomRepository(LeaderboardRepository);
    const leaderboards = await leaderboardRepository.findUsers(params.first, params.after);

    const url = `${request.protocol}://${request.get('host')}${request.baseUrl}${request.path}`;

    const pagination = {
        before: `${url}?first=${params.first}&after=${_.clamp(params.after - params.first, 0, params.after)}`,
        after: `${url}?first=${params.first}&after=${params.after + params.first}`,
    };

    if (leaderboards.length === 0) pagination.after = null;
    if (params.after === 0) pagination.before = null;

    return response.json({
        data: leaderboards,
        pagination,
    });
}
