export function generateGuide(preset: string): string {
  switch (preset) {
    case "character":
      return characterGuide();
    case "weapon":
      return weaponGuide();
    case "prop":
      return propGuide();
    case "custom":
      return customGuide();
    default:
      return `Unknown preset "${preset}". Available: character, weapon, prop, custom.`;
  }
}

function characterGuide(): string {
  return `# Character Animation Guide

## AGR Variables
- Float Speed [0..10] -- movement speed for locomotion blending
- Float MoveDir [-180..180] -- movement direction relative to facing
- Float Stance [0..2] -- 0=erect, 1=crouch, 2=prone
- Float AimX [-180..180] -- horizontal aim offset
- Float AimY [-90..90] -- vertical aim offset
- Int WeaponType [0..5] -- current weapon category
- Bool IsAiming -- whether actively aiming down sights

## Commands
- CMD_Death, CMD_Hit -- damage reactions
- CMD_Reload, CMD_ThrowGrenade, CMD_Melee -- action animations
- CMD_ChangeStance -- stance transitions

## IK Chains
Set up these chains in the AGR ControlTemplate:
- LeftLeg: thigh_l -> calf_l -> foot_l (ChainAxis: +y) -- foot placement IK
- RightLeg: thigh_r -> calf_r -> foot_r (ChainAxis: -y)
- LeftArm: upperarm_l -> lowerarm_l -> hand_l -- weapon grip IK
- RightArm: upperarm_r -> lowerarm_r -> hand_r
- Spine: spine_01 -> spine_02 -> spine_03 -- aim/lean IK

## Bone Masks
- UpperBody: spine_01 and above -- for aim overlay
- LowerBody: pelvis and below -- for locomotion isolation

## AGF Layout
Recommended node hierarchy:
1. Queue "MasterQueue" -- top-level action queue
   - Default Child -> Locomotion StateMachine
   - QueueItems for Reload, Grenade, Melee (with InterruptExpr)
2. StateMachine "LocomotionSM" -- movement states
   - State "Idle" (StartCondition "Speed == 0", Time Normtime)
   - State "Walk" (StartCondition "Speed > 0 && Speed <= 3")
   - State "Run" (StartCondition "Speed > 3")
   - State "Prone" (StartCondition "Stance == 2", Time Notime, child -> ProneSM)
   - Catch-all state with StartCondition "1"
   - Transitions with Duration 0.3, BlendFn S, PostEval where needed
3. Blend "AimOverlay" -- aim X/Y blending
   - Use Filter with UpperBody bone mask
   - BlendWeight "AimWeight" with Optimization 1
4. IK Pipeline -- foot IK, hand IK
   - IK2 nodes with TwoBoneSolver for legs
   - IK2Target for hand placement on weapon

## Prefab Wiring
Add to your character entity prefab:
- AnimationControllerComponent
  - AnimGraph: reference to your .agr file
  - AnimInstance: reference to your .asi file
- MeshObject: reference to your character model

## Tips
- Use Normtime for looping anims, Realtime for one-shots
- Always have a catch-all state (StartCondition "1") in every StateMachine
- Use BufferSave/BufferUse to preserve base pose when layering overlays
- Set PostEval 1 on transitions using RemainingTimeLess() or IsEvent()
`;
}

function weaponGuide(): string {
  return `# Weapon Animation Guide

## AGR Variables
- Int FireMode [0..3] -- 0=semi, 1=burst, 2=auto, 3=safety
- Int MagCount [0..30] -- remaining magazine count
- Bool SafetyOn -- weapon safety state

## Commands
- CMD_Fire -- firing animation trigger
- CMD_Reload -- magazine reload
- CMD_Inspect -- weapon inspection
- CMD_SafetyToggle -- toggle safety on/off

## AGF Layout
Weapons typically use a simple Queue-based structure:
1. Queue "WeaponQueue" -- main action queue
   - Default Child -> "IdleSrc" (bind pose or idle animation)
   - QueueItem for Fire:
     - StartExpr "IsCommand(CMD_Fire)"
     - InterruptExpr "!IsCommand(CMD_Fire)"
     - EnqueueMethod Replace
     - BlendInTime 0.1
   - QueueItem for Reload:
     - StartExpr "IsCommand(CMD_Reload)"
     - InterruptExpr "IsCommand(CMD_Cancel)"
     - EnqueueMethod Replace
     - BlendInTime 0.2
     - BlendOutTime 0.3
   - QueueItem for Inspect:
     - StartExpr "IsCommand(CMD_Inspect)"
     - BlendInTime 0.3
     - BlendOutTime 0.3

## AST/ASI Structure
- Animation Group "Weapon" with columns matching weapon variants
- AnimationNames: "Fire", "Reload", "Inspect", "Idle"
- Each column maps to specific .anm files

## Prefab Wiring
- WeaponComponent on the weapon entity
- AnimationControllerComponent with AnimGraph and AnimInstance
- Ensure bone naming matches the character skeleton attachment points
`;
}

function propGuide(): string {
  return `# Prop Animation Guide

## ProcTransform Patterns
Props (spinning objects, oscillating parts, mechanical elements) use ProcTransform nodes:

### Continuous Spin
AnimSrcNodeProcTransform WheelSpin {
 Child "BindPose"
 Expression "1"
 Bones {
  AnimSrcNodeProcTrBoneItem {
   Bone "prop_rotor"
   Op Rotate
   Axis Y
   Amount "GetUpperRTime() * RotationSpeed"
  }
 }
}

### Oscillation
AnimSrcNodeProcTransform Pendulum {
 Child "BindPose"
 Expression "1"
 Bones {
  AnimSrcNodeProcTrBoneItem {
   Bone "pendulum_arm"
   Op Rotate
   Axis Z
   Amount "sin(GetUpperRTime() * SwingFreq) * SwingAmplitude"
  }
 }
}

### Translation
AnimSrcNodeProcTrBoneItem {
 Bone "piston_rod"
 Op Translate
 Axis Y
 Amount "sin(GetUpperRTime() * CycleSpeed) * StrokeLength"
}

## AGR Variables
- Float RotationSpeed [0..100] default=1.0 -- controls spin rate
- Float SwingFreq [0..10] default=1.0 -- oscillation frequency
- Float SwingAmplitude [0..90] default=30.0 -- oscillation range in degrees

## Key Rules
- Always use GetUpperRTime() for time, never $Time (which resets on state changes)
- Extract hardcoded multipliers to AGR variables for runtime control
- Use Expression "1" as default (always active), or tie to a Bool variable

## Prefab Wiring
Add to your prop entity prefab:
- BaseItemAnimationComponent (or AnimationControllerComponent for complex setups)
  - AnimGraph: reference to your .agr file
  - AnimInstance: reference to your .asi file
- Ensure the prop's mesh skeleton has matching bone names
`;
}

function customGuide(): string {
  return `# Custom Animation Setup Questionnaire

Answer these questions to determine the right animation architecture:

## 1. Skeleton
- How many bones does your model have?
- Which bones need animation? (list key bone names)
- Are there any bone chains for IK? (e.g., leg chain, arm chain)

## 2. States
- What distinct animation states does your object have? (e.g., idle, active, damaged)
- How do states transition? (conditions, timing)
- Are any states looping vs. one-shot?

## 3. Inputs
- What script variables drive the animation? (floats, ints, bools)
- What commands trigger actions? (list CMD_ names)
- Are inputs from the simulation or player input?

## 4. IK Requirements
- Do you need inverse kinematics? (foot placement, hand grip, look-at)
- Which solver type? (TwoBone for limbs, LookAt for head/turret)
- How many IK chains are needed?

## 5. Blending
- Do you need to blend between animations? (locomotion speed blending)
- Do you need additive overlays? (aim offset, damage lean)
- Do you need bone mask filtering? (upper/lower body split)

## 6. Procedural Motion
- Do any parts need procedural rotation/translation? (wheels, rotors, pistons)
- What drives the speed? (variable, constant)

## 7. Component
- What entity component will host the animation?
  - AnimationControllerComponent (full graph support)
  - BaseItemAnimationComponent (simple prop animation)

Provide your answers and I will generate a tailored animation graph architecture.
`;
}
