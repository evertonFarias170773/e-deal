import type { MaestroSpecialist } from './specialist.types';
import { ComercialSpecialist } from './comercial/comercial.specialist';

class SpecialistRegistry {
  private specialists = new Map<string, MaestroSpecialist>();

  constructor() {
    this.register(new ComercialSpecialist());
  }

  register(specialist: MaestroSpecialist): void {
    this.specialists.set(specialist.id, specialist);
  }

  resolve(id?: string): MaestroSpecialist | null {
    if (!id) return null;
    return this.specialists.get(id) || null;
  }

  listAvailable(): MaestroSpecialist[] {
    return Array.from(this.specialists.values());
  }
}

export const specialistRegistry = new SpecialistRegistry();
