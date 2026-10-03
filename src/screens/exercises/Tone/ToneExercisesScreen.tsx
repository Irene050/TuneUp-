import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#A58F84';

const toneExercises = [
	{
		id: 'vowel-consistency',
		number: '1',
		title: 'Vowel Consistency Exercise',
		description:
			'Keep vowel shape steady while sustaining a clear and even tone.',
		templateId: 'vowelConsistencyExercise',
	},
	{
		id: 'waveform-smoothness',
		number: '2',
		title: 'Waveform Smoothness Drill',
		description:
			'Smooth out your pitch and resonance for a balanced vocal sound.',
		templateId: 'waveformSmoothnessDrill',
	},
	{
		id: 'resonance-stabilization',
		number: '3',
		title: 'Resonance Stabilization Task',
		description:
			'Focus on steady resonance and consistent vocal placement.',
		templateId: 'resonanceStabilizationTask',
	},
	{
		id: 'tone-consistency',
		number: '4',
		title: 'Tone Consistency Exercise',
		description:
			'Maintain the same tonal quality from start to finish.',
		templateId: 'toneConsistencyExercise',
	},
	{
		id: 'steady-tone-holding',
		number: '5',
		title: 'Steady Tone Holding',
		description:
			'Hold a focused, even tone without drifting in brightness or pitch.',
		templateId: 'steadyToneHolding',
	},
];

const openExercise = (templateId: string) => {
	router.push(
		`/exercises/tone?templateId=${encodeURIComponent(templateId)}` as any,
	);
};

export default function ToneExercisesScreen() {
	return (
		<View style={styles.screen}>
			<View style={styles.header}>
				<Pressable
					style={styles.backButton}
					onPress={() => router.back()}
				>
					<Ionicons
						name="arrow-back"
						size={19}
						color={BROWN}
					/>
				</Pressable>

						<Image
							source={require('@/assets/images/tabIcons/tuneup-logo.png')}
							style={styles.logo}
							resizeMode="contain"
						/>

				<View style={styles.headerSpacer} />
			</View>

			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={styles.content}
			>
				<Text style={styles.pageTitle}>Tone</Text>

				<Text style={styles.pageSubtitle}>
					Refine resonance, consistency, and vocal color.
				</Text>

				<View style={styles.exerciseList}>
					{toneExercises.map((exercise) => (
						<Pressable
							key={exercise.id}
							style={({ pressed }) => [
								styles.exerciseCard,
								pressed && styles.pressed,
							]}
							onPress={() => openExercise(exercise.templateId)}
						>
							<View style={styles.exerciseNameContainer}>
								<Text style={styles.exerciseName} numberOfLines={2}>
									{exercise.title}
								</Text>
							</View>

							<View style={styles.levelBadge}>
								<Text style={styles.levelText}>Beginner</Text>
							</View>

							<Text style={styles.exerciseCategory} numberOfLines={1}>
								Tone
							</Text>

							<View style={styles.listPlayButton}>
								<Ionicons name="play" size={16} color={BROWN} />
							</View>
						</Pressable>
					))}
				</View>

				<Pressable
					style={({ pressed }) => [
						styles.freeMode,
						pressed && styles.freeModePressed,
					]}
					  onPress={() => router.push('/exercises/tone?mode=free' as any)}
				>
					<View style={styles.freeModeIcon}>
						<Ionicons
							name="musical-notes"
							size={20}
							color={BROWN}
						/>
					</View>

					<View style={styles.freeModeText}>
						<Text style={styles.freeModeTitle}>Free Mode</Text>

						<Text style={styles.freeModeDescription}>
							Explore your natural tone without a structured drill.
						</Text>
					</View>

					<Ionicons name="chevron-forward" size={18} color={BROWN} />
				</Pressable>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		backgroundColor: WHITE,
	},
	header: {
		height: 72,
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 17,
		position: 'relative',
	},
	backButton: {
		width: 34,
		height: 34,
		borderRadius: 17,
		backgroundColor: 'transparent',
		alignItems: 'center',
		justifyContent: 'center',
		marginTop: 72,
	},
	headerTitle: {
		flex: 1,
		textAlign: 'center',
		fontFamily: 'FredokaBold',
		fontSize: 17,
		color: BROWN,
	},
	headerSpacer: {
		width: 34,
	},
	content: {
		paddingHorizontal: 24,
		paddingTop: 36,
		paddingBottom: 35,
	},
	logo: {
		width: 45,
		height: 45,
		marginBottom: 0,
		marginTop: 68.4,
		position: 'absolute',
		left: '50%',
		marginLeft: -5.5,
	},
	pageTitle: {
		fontFamily: 'FredokaBold',
		fontSize: 32,
		color: BROWN,
		marginTop: 16,
	},
	pageSubtitle: {
		fontFamily: 'FredokaRegular',
		fontSize: 12,
		lineHeight: 18,
		color: MUTED,
		marginTop: 2,
		marginBottom: 16,
	},
	exerciseList: {
			gap: 5,
			marginTop: 4,
	},
	exerciseCard: {
		flexDirection: 'row',
		alignItems: 'center',
			minHeight: 64,
			backgroundColor: LIGHT_PINK,
			borderRadius: 9,
			paddingVertical: 9,
			paddingHorizontal: 14,
		borderWidth: 0,
	},
		exerciseNameContainer: {
			width: 108,
		},
		exerciseName: {
			fontFamily: 'FredokaRegular',
			fontSize: 15,
			lineHeight: 17,
			color: BROWN,
		},
		levelBadge: {
			width: 61,
			backgroundColor: PINK,
			borderRadius: 10,
			paddingVertical: 3,
			alignItems: 'center',
			justifyContent: 'center',
			marginRight: 14,
		},
		levelText: {
			fontFamily: 'FredokaBold',
			fontSize: 8,
			color: BROWN,
		},
		exerciseCategory: {
			flex: 1,
			fontFamily: 'FredokaRegular',
			fontSize: 10,
			lineHeight: 12,
			color: BROWN,
		},
		listPlayButton: {
			width: 32,
			height: 32,
			borderRadius: 16,
			backgroundColor: WHITE,
			alignItems: 'center',
			justifyContent: 'center',
			shadowColor: '#000',
			shadowOpacity: 0.1,
			shadowRadius: 3,
			shadowOffset: { width: 0, height: 2 },
			elevation: 2,
		},
	pressed: {
		opacity: 0.9,
	},
	numberCircle: {
		width: 28,
		height: 28,
		borderRadius: 14,
		backgroundColor: PINK,
		alignItems: 'center',
		justifyContent: 'center',
		marginRight: 10,
	},
	numberText: {
		fontFamily: 'FredokaSemiBold',
		fontSize: 12,
		color: BROWN,
	},
	iconCircle: {
			width: 38,
			height: 38,
			borderRadius: 19,
		backgroundColor: '#FDEBF2',
		alignItems: 'center',
		justifyContent: 'center',
			marginRight: 10,
	},
	exerciseInfo: {
		flex: 1,
		marginRight: 10,
	},
	exerciseTitle: {
		fontFamily: 'FredokaSemiBold',
		fontSize: 15,
		color: BROWN,
		marginBottom: 3,
	},
	exerciseDescription: {
		fontFamily: 'FredokaRegular',
		fontSize: 11,
		lineHeight: 15,
		color: MUTED,
	},
	playButton: {
		width: 28,
		height: 28,
		borderRadius: 14,
		backgroundColor: PINK,
		alignItems: 'center',
		justifyContent: 'center',
	},
	freeMode: {
		marginTop: 24,
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: '#FFF4F6',
		borderRadius: 18,
		borderWidth: 1,
		borderColor: '#F2C9D5',
		padding: 14,
	},
	freeModePressed: {
		opacity: 0.9,
	},
	freeModeIcon: {
		width: 36,
		height: 36,
		borderRadius: 12,
		backgroundColor: PINK,
		alignItems: 'center',
		justifyContent: 'center',
		marginRight: 12,
	},
	freeModeText: {
		flex: 1,
	},
	freeModeTitle: {
		fontFamily: 'FredokaSemiBold',
		fontSize: 15,
		color: BROWN,
	},
	freeModeDescription: {
		fontFamily: 'FredokaRegular',
		fontSize: 11,
		color: MUTED,
		marginTop: 2,
	},
});
