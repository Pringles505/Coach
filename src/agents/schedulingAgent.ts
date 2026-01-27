import {
    Task,
    TaskStatus,
    TaskPriority,
    TimeSlot,
    FocusSession,
    UserPreferences
} from '../types';

/**
 * SchedulingAgent assigns tasks to time slots based on priority, effort, and dependencies.
 *
 * Responsibilities:
 * - Schedule tasks within work hours
 * - Respect task dependencies
 * - Create focus sessions for deep work
 * - Balance workload across days
 * - Handle rescheduling when tasks are completed or deferred
 */
export class SchedulingAgent {
    private readonly name = 'SchedulingAgent';

    /**
     * Schedule a list of tasks based on user preferences
     */
    async scheduleTasks(
        tasks: Task[],
        preferences: UserPreferences,
        daysAhead = 14
    ): Promise<Task[]> {
        // Sort by priority and dependencies
        const sortedTasks = this.topologicalSort(tasks);

        // Get available time slots
        const availableSlots = this.generateTimeSlots(preferences, daysAhead);

        // Assign tasks to slots
        const scheduledTasks: Task[] = [];
        let slotIndex = 0;

        for (const task of sortedTasks) {
            // Find next available slot that fits this task
            while (slotIndex < availableSlots.length) {
                const slot = availableSlots[slotIndex];
                const slotMinutes = this.getSlotMinutes(slot);

                if (slotMinutes >= task.estimatedMinutes) {
                    // Schedule task in this slot
                    scheduledTasks.push({
                        ...task,
                        status: TaskStatus.Scheduled,
                        scheduledDate: slot.start,
                        scheduledTimeSlot: {
                            start: slot.start,
                            end: new Date(slot.start.getTime() + task.estimatedMinutes * 60000)
                        },
                        updatedAt: new Date()
                    });

                    // Consume slot time
                    slot.start = new Date(slot.start.getTime() + task.estimatedMinutes * 60000);

                    // If slot is too small for any remaining task, move to next
                    if (this.getSlotMinutes(slot) < 15) {
                        slotIndex++;
                    }

                    break;
                }

                slotIndex++;
            }

            // If no slot found, leave task unscheduled
            if (!scheduledTasks.find(t => t.id === task.id)) {
                scheduledTasks.push({
                    ...task,
                    status: TaskStatus.Pending,
                    updatedAt: new Date()
                });
            }
        }

        return scheduledTasks;
    }

    /**
     * Reschedule a single task to a new date
     */
    rescheduleTask(task: Task, newDate: Date, preferences: UserPreferences): Task {
        const workStart = new Date(newDate);
        workStart.setHours(preferences.workHoursStart, 0, 0, 0);

        const workEnd = new Date(newDate);
        workEnd.setHours(preferences.workHoursEnd, 0, 0, 0);

        return {
            ...task,
            scheduledDate: workStart,
            scheduledTimeSlot: {
                start: workStart,
                end: new Date(workStart.getTime() + task.estimatedMinutes * 60000)
            },
            status: TaskStatus.Scheduled,
            updatedAt: new Date()
        };
    }

    /**
     * Create focus sessions by grouping related tasks
     */
    createFocusSessions(
        tasks: Task[],
        preferences: UserPreferences
    ): FocusSession[] {
        const sessions: FocusSession[] = [];
        const sessionDuration = preferences.focusSessionDuration;

        // Group tasks by type and file
        const tasksByType = this.groupTasksByType(tasks);

        for (const [type, typeTasks] of Object.entries(tasksByType)) {
            // Create sessions for each type
            let currentSession: Task[] = [];
            let currentDuration = 0;

            for (const task of typeTasks) {
                if (currentDuration + task.estimatedMinutes <= sessionDuration) {
                    currentSession.push(task);
                    currentDuration += task.estimatedMinutes;
                } else {
                    if (currentSession.length > 0) {
                        sessions.push(this.createSession(currentSession, type));
                    }
                    currentSession = [task];
                    currentDuration = task.estimatedMinutes;
                }
            }

            if (currentSession.length > 0) {
                sessions.push(this.createSession(currentSession, type));
            }
        }

        return sessions;
    }

    /**
     * Optimize schedule by reordering tasks for efficiency
     */
    optimizeSchedule(tasks: Task[]): Task[] {
        // Group by file to minimize context switching
        const byFile = new Map<string, Task[]>();

        for (const task of tasks) {
            const file = task.affectedFiles[0] || 'unknown';
            if (!byFile.has(file)) {
                byFile.set(file, []);
            }
            byFile.get(file)!.push(task);
        }

        // Flatten back, keeping file groups together
        const optimized: Task[] = [];
        for (const fileTasks of byFile.values()) {
            // Sort within file by priority
            fileTasks.sort((a, b) => b.priority - a.priority);
            optimized.push(...fileTasks);
        }

        return optimized;
    }

    /**
     * Calculate workload statistics
     */
    calculateWorkload(tasks: Task[]): {
        totalMinutes: number;
        scheduledMinutes: number;
        byDay: Map<string, number>;
        byType: Record<string, number>;
    } {
        let totalMinutes = 0;
        let scheduledMinutes = 0;
        const byDay = new Map<string, number>();
        const byType: Record<string, number> = {};

        for (const task of tasks) {
            totalMinutes += task.estimatedMinutes;

            if (task.scheduledDate) {
                scheduledMinutes += task.estimatedMinutes;

                const dayKey = task.scheduledDate.toISOString().split('T')[0];
                byDay.set(dayKey, (byDay.get(dayKey) || 0) + task.estimatedMinutes);
            }

            byType[task.type] = (byType[task.type] || 0) + task.estimatedMinutes;
        }

        return { totalMinutes, scheduledMinutes, byDay, byType };
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    private topologicalSort(tasks: Task[]): Task[] {
        const sorted: Task[] = [];
        const visited = new Set<string>();
        const taskMap = new Map(tasks.map(t => [t.id, t]));

        const visit = (task: Task) => {
            if (visited.has(task.id)) return;
            visited.add(task.id);

            // Visit dependencies first
            for (const depId of task.dependencies) {
                const dep = taskMap.get(depId);
                if (dep) {
                    visit(dep);
                }
            }

            sorted.push(task);
        };

        // Sort by priority first, then topologically
        const prioritySorted = [...tasks].sort((a, b) => b.priority - a.priority);

        for (const task of prioritySorted) {
            visit(task);
        }

        return sorted;
    }

    private generateTimeSlots(
        preferences: UserPreferences,
        days: number
    ): TimeSlot[] {
        const slots: TimeSlot[] = [];
        const now = new Date();

        for (let d = 0; d < days; d++) {
            const date = new Date(now);
            date.setDate(date.getDate() + d);

            // Skip weekends
            if (date.getDay() === 0 || date.getDay() === 6) {
                continue;
            }

            const start = new Date(date);
            start.setHours(preferences.workHoursStart, 0, 0, 0);

            const end = new Date(date);
            end.setHours(preferences.workHoursEnd, 0, 0, 0);

            // Don't schedule in the past
            if (end > now) {
                const effectiveStart = start > now ? start : now;
                if (effectiveStart < end) {
                    slots.push({ start: effectiveStart, end });
                }
            }
        }

        return slots;
    }

    private getSlotMinutes(slot: TimeSlot): number {
        return Math.floor((slot.end.getTime() - slot.start.getTime()) / 60000);
    }

    private groupTasksByType(tasks: Task[]): Record<string, Task[]> {
        const byType: Record<string, Task[]> = {};

        for (const task of tasks) {
            if (!byType[task.type]) {
                byType[task.type] = [];
            }
            byType[task.type].push(task);
        }

        return byType;
    }

    private createSession(tasks: Task[], type: string): FocusSession {
        const start = tasks[0].scheduledTimeSlot?.start || new Date();
        const totalMinutes = tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
        const end = new Date(start.getTime() + totalMinutes * 60000);

        return {
            id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            start,
            end,
            taskIds: tasks.map(t => t.id),
            label: `${type.charAt(0).toUpperCase() + type.slice(1)} Focus`
        };
    }
}
