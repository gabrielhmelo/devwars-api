import { Column, Entity, OneToOne, OneToMany, JoinColumn } from 'typeorm';
import BaseModel from './BaseModel';
import Game from './Game';
import GameApplication from './GameApplication';

export enum GameStatus {
    SCHEDULED,
    ACTIVE,
    ENDED,
}

@Entity('game_schedule')
export default class GameSchedule extends BaseModel {
    @Column()
    public startTime: Date;

    @Column({ default: GameStatus.SCHEDULED })
    public status: GameStatus;

    @Column({ type: 'jsonb' })
    public setup: any;

    // ------------------------------------------------------------
    // Relations

    @JoinColumn()
    @OneToOne(() => Game, { onDelete: 'CASCADE' })
    public game: Game;

    @OneToMany(
        () => GameApplication,
        (applications) => applications.schedule,
        { cascade: true }
    )
    public applications: GameApplication;
}
